"""CORS preflight on /detect."""


def _preflight(client, origin):
    return client.options(
        "/detect",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )


def test_preflight_from_frontend_allowed(client):
    """M1-cors-01"""
    response = _preflight(client, "http://localhost:5173")

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_preflight_from_unknown_origin_denied(client):
    """M1-cors-02"""
    response = _preflight(client, "http://evil.example")

    assert response.status_code != 200
    assert "access-control-allow-origin" not in response.headers
