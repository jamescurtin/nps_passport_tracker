import argparse
import json
import os
from typing import Any, Dict, Iterator, List

import requests
from pydantic import BaseModel, HttpUrl
from requests.exceptions import HTTPError, JSONDecodeError

JSONType = Dict[str, Any]

BASE_URL: str = "https://developer.nps.gov/api/v1"
HEADERS: Dict[str, str] = {"X-Api-Key": os.environ["NPS_API_KEY"]}
MAX_PICTURES_PER_SITE: int = 2


class Photo(BaseModel):
    url: HttpUrl
    title: str
    altText: str  # noqa: N815


class NationalPark(BaseModel):
    id: str
    url: HttpUrl
    name: str
    fullName: str  # noqa: N815
    parkCode: str  # noqa: N815
    description: str
    latitude: float
    longitude: float
    images: List[Photo]


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
    park_data = [NationalPark(**record) for record in raw_data]
    park_data.sort(key=lambda x: x.name)
    for park in park_data:
        park.images.sort(key=lambda x: x.title)
        park.images = park.images[:MAX_PICTURES_PER_SITE]

    with open(args.file, "w") as f:
        json.dump([m.dict() for m in park_data], f)


if __name__ == "__main__":
    main()
