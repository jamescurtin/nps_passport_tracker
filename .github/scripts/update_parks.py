import argparse
import json
import os
from pprint import pformat
from typing import Any, Iterator

import requests
from pydantic import (
    BaseModel,
    ConfigDict,
    HttpUrl,
    ValidationError,
    field_serializer,
    field_validator,
)
from requests.adapters import HTTPAdapter, Retry
from requests.exceptions import HTTPError, JSONDecodeError

JSONType = dict[str, Any]

BASE_URL: str = "https://developer.nps.gov/api/v1"
MAX_PICTURES_PER_SITE: int = 2
# (connect timeout, read timeout) applied to every request, so a stalled NPS
# endpoint fails fast instead of hanging until the CI job timeout.
REQUEST_TIMEOUT: tuple[int, int] = (5, 30)
# Abort (rather than silently overwrite parks.json) if more than this fraction
# of fetched records fail validation, which would indicate an upstream schema
# change rather than a few malformed units.
MAX_DROP_FRACTION: float = 0.05
# NPS units containing the following designations in their name will be excluded
# from the list of parks used to populate the map.
EXCLUDED_DESIGNATIONS: set[str] = {
    "Affiliated Area",
    "Bay",
    "National Geologic Trail",
    "National Historic Trail",
    "National Recreational River",
    "National River",
    "National Scenic River",
    "National Scenic Trail",
    "Public Lands",
    "Scenic & Recreational River",
    "Scenic River",
    "Scenic Riverway",
    "Wild and Scenic River",
    "Wild River",
}


def _to_camel(snake_string: str) -> str:
    first, *others = snake_string.split("_")
    return "".join([first.lower(), *map(str.title, others)])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel)


class Photo(CamelModel):
    url: HttpUrl
    title: str
    alt_text: str

    @field_serializer("url")
    def serialize_url(self, url: HttpUrl) -> str:
        """Serialize URL to string.

        Args:
            url (HttpUrl): url

        Returns:
            str: serialized URL
        """
        return str(url)


class NationalPark(CamelModel):
    """National park data model.

    Full data model is available at
    https://www.nps.gov/subjects/developer/api-documentation.htm
    """

    id: str
    url: HttpUrl
    name: str
    full_name: str
    park_code: str
    description: str
    latitude: float
    longitude: float
    states: list[str]
    images: list[Photo]

    @field_validator("states", mode="before")
    def split_states(cls, v: str | list[str]) -> list[str]:
        """Takes comma separated list of states and splits them into a list.

        Args:
            v (str | list[str]): States either as a list or comma separated string

        Returns:
            list[str]: List of states
        """
        if isinstance(v, str):
            return v.split(",")
        return v

    @field_validator("latitude")
    def validate_latitude(cls, v: float) -> float:
        """Ensure latitude is within the valid range.

        Args:
            v (float): Latitude value

        Returns:
            float: Validated latitude
        """
        if not -90 <= v <= 90:
            raise ValueError(f"latitude out of range: {v}")
        return v

    @field_validator("longitude")
    def validate_longitude(cls, v: float) -> float:
        """Ensure longitude is within the valid range.

        Args:
            v (float): Longitude value

        Returns:
            float: Validated longitude
        """
        if not -180 <= v <= 180:
            raise ValueError(f"longitude out of range: {v}")
        return v

    @field_serializer("url")
    def serialize_url(self, url: HttpUrl) -> str:
        """Serialize URL to string.

        Args:
            url (HttpUrl): url

        Returns:
            str: serialized URL
        """
        return str(url)


def _park_has_excluded_designation(park_name: str) -> bool:
    return any(park_name.endswith(designation) for designation in EXCLUDED_DESIGNATIONS)


def _build_session() -> requests.Session:
    """Create a requests Session with API-key auth and retry/backoff.

    The NPS API key is read here (not at import time) so the module can be
    imported and unit-tested without the secret present.

    Returns:
        requests.Session: session configured with the API key header and a
            retry policy for transient errors and rate limiting.
    """
    api_key = os.environ.get("NPS_API_KEY")
    if not api_key:
        raise SystemExit("NPS_API_KEY environment variable is not set")
    session = requests.Session()
    session.headers.update({"X-Api-Key": api_key})
    retry = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def _process_response(response: requests.Response) -> JSONType:
    try:
        response.raise_for_status()
    except HTTPError:
        raise ValueError(f"Error loading {response.url}")
    try:
        json_body = response.json()
    except JSONDecodeError as ex:
        raise ValueError(f"Unable to parse JSON from {response.url}") from ex
    return json_body


def get_paginated_json_response(
    url: str, limit: int, session: requests.Session
) -> Iterator[JSONType]:
    start = 0
    first_page = session.get(
        url, params={"limit": limit, "start": start}, timeout=REQUEST_TIMEOUT
    )
    first_page_json = _process_response(first_page)
    yield first_page_json

    try:
        total_results = int(first_page_json["total"])
    except KeyError:
        raise ValueError(f"Unable to find key 'total' in response from {url}")

    results_fetched = start + limit
    while results_fetched < total_results:
        start += limit
        next_page = session.get(
            url, params={"limit": limit, "start": start}, timeout=REQUEST_TIMEOUT
        )
        yield _process_response(next_page)
        results_fetched += limit


def main() -> None:
    parser = argparse.ArgumentParser(description="Update NPS Sites JSON")
    parser.add_argument("file", type=str, help="Path of parks.json")
    args = parser.parse_args()

    session = _build_session()
    raw_data = []
    for page in get_paginated_json_response(f"{BASE_URL}/parks", 100, session):
        raw_data.extend(page["data"])

    park_data = []
    dropped = 0
    for record in raw_data:
        try:
            park_data.append(NationalPark(**record))
        except ValidationError as ex:
            dropped += 1
            exception_str = (
                f"Unable to process the following record:\n{pformat(record)}\n\n{ex}"
            )
            print(json.dumps(exception_str))

    if raw_data and dropped / len(raw_data) > MAX_DROP_FRACTION:
        raise SystemExit(
            f"Aborting: {dropped} of {len(raw_data)} records failed validation "
            f"(more than {MAX_DROP_FRACTION:.0%}); refusing to overwrite "
            "parks.json. This likely indicates an upstream API change."
        )

    park_data = [
        park for park in park_data if not _park_has_excluded_designation(park.full_name)
    ]
    for park in park_data:
        park.images.sort(key=lambda x: x.title)
        park.images = park.images[:MAX_PICTURES_PER_SITE]
    park_data.sort(key=lambda x: x.name)

    with open(args.file, "w") as f:
        json.dump([m.model_dump(by_alias=True) for m in park_data], f)


if __name__ == "__main__":
    main()
