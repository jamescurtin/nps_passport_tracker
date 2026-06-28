from typing import Any
from unittest.mock import MagicMock

import pytest
import update_parks
from pydantic import ValidationError
from update_parks import (
    NationalPark,
    _build_session,
    _park_has_excluded_designation,
    get_paginated_json_response,
)


def _valid_record(**overrides: Any) -> dict[str, Any]:
    record: dict[str, Any] = {
        "id": "abc123",
        "url": "https://www.nps.gov/yell",
        "name": "Yellowstone",
        "fullName": "Yellowstone National Park",
        "parkCode": "yell",
        "description": "First national park.",
        "latitude": 44.6,
        "longitude": -110.5,
        "states": "WY,MT,ID",
        "images": [
            {
                "url": "https://www.nps.gov/yell/photo.jpg",
                "title": "A photo",
                "altText": "A scenic view",
            }
        ],
        "designation": "National Park",
    }
    record.update(overrides)
    return record


def test_split_states_from_comma_string() -> None:
    park = NationalPark(**_valid_record(states="WY,MT,ID"))
    assert park.states == ["WY", "MT", "ID"]


def test_split_states_from_list() -> None:
    park = NationalPark(**_valid_record(states=["WY", "MT"]))
    assert park.states == ["WY", "MT"]


def test_designation_defaults_to_empty_when_absent() -> None:
    record = _valid_record()
    del record["designation"]
    park = NationalPark(**record)
    assert park.designation == ""


@pytest.mark.parametrize("latitude", [-91, 91, 200])
def test_latitude_out_of_range_rejected(latitude: float) -> None:
    with pytest.raises(ValidationError):
        NationalPark(**_valid_record(latitude=latitude))


@pytest.mark.parametrize("longitude", [-181, 181, 999])
def test_longitude_out_of_range_rejected(longitude: float) -> None:
    with pytest.raises(ValidationError):
        NationalPark(**_valid_record(longitude=longitude))


def test_excluded_by_designation_field() -> None:
    park = NationalPark(
        **_valid_record(
            fullName="Some Unit",
            designation="National Historic Trail",
        )
    )
    assert _park_has_excluded_designation(park) is True


def test_excluded_by_name_suffix_fallback() -> None:
    # designation empty, but the name suffix still matches.
    park = NationalPark(
        **_valid_record(
            fullName="Niobrara National Scenic River",
            designation="",
        )
    )
    assert _park_has_excluded_designation(park) is True


def test_not_excluded_for_regular_park() -> None:
    park = NationalPark(**_valid_record())
    assert _park_has_excluded_designation(park) is False


def test_build_session_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NPS_API_KEY", raising=False)
    with pytest.raises(SystemExit):
        _build_session()


def test_build_session_sets_auth_header(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NPS_API_KEY", "secret-key")
    session = _build_session()
    assert session.headers["X-Api-Key"] == "secret-key"


def test_get_paginated_json_response_follows_pagination() -> None:
    page_one = MagicMock()
    page_one.json.return_value = {"total": "2", "data": [{"parkCode": "a"}]}
    page_two = MagicMock()
    page_two.json.return_value = {"total": "2", "data": [{"parkCode": "b"}]}

    session = MagicMock()
    session.get.side_effect = [page_one, page_two]

    pages = list(get_paginated_json_response("http://example/parks", 1, session))

    assert [p["data"][0]["parkCode"] for p in pages] == ["a", "b"]
    assert session.get.call_count == 2
    # Every request must carry a timeout.
    for call in session.get.call_args_list:
        assert call.kwargs["timeout"] == update_parks.REQUEST_TIMEOUT
