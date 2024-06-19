import argparse
import json
import os
from pprint import pformat
from typing import Any, Iterator

import requests
from pydantic import (
    BaseModel,
    HttpUrl,
    ValidationError,
    field_serializer,
    field_validator,
)
from requests.exceptions import HTTPError, JSONDecodeError

JSONType = dict[str, Any]

BASE_URL: str = "https://developer.nps.gov/api/v1"
HEADERS: dict[str, str] = {"X-Api-Key": os.environ["NPS_API_KEY"]}
MAX_PICTURES_PER_SITE: int = 2
# NPS units containing the following designations in their name will be excluded
# from the list of parks used to populate the map.
EXCLUDED_DESIGNATIONS: set[str] = {
    "Affiliated Area",
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
    class Config:
        """Pydantic config to convert snake_case to camelCase aliases."""

        alias_generator = _to_camel


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
    return any(designation in park_name for designation in EXCLUDED_DESIGNATIONS)


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


def get_paginated_json_response(url: str, limit: int) -> Iterator[JSONType]:
    session = requests.Session()
    start = 0
    first_page = session.get(
        url, headers=HEADERS, params={"limit": limit, "start": start}
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
            url, headers=HEADERS, params={"limit": limit, "start": start}
        )
        yield _process_response(next_page)
        results_fetched += limit


def main() -> None:
    parser = argparse.ArgumentParser(description="Update NPS Sites JSON")
    parser.add_argument("file", type=str, help="Path of parks.json")
    args = parser.parse_args()

    raw_data = []
    for page in get_paginated_json_response(f"{BASE_URL}/parks", 100):
        raw_data.extend(page["data"])

    park_data = []
    for record in raw_data:
        try:
            park_data.append(NationalPark(**record))
        except ValidationError as ex:
            exception_str = (
                f"Unable to process the following record:\n{pformat(record)}\n\n{ex}"
            )
            print(json.dumps(exception_str))
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
