"""
Habesha Music Tracker -- iTunes edition.

Populates the same Google Sheet tabs as the Spotify tracker (main.py), but
sources tracks from Apple's public iTunes Search API instead of Spotify's
authenticated API. No developer account or API key is needed for iTunes --
it's a free, unauthenticated JSON API -- so the only secret this script
needs is the Google service account key (GCP_SA_KEY) for writing to Sheets.

Two real limitations of the iTunes API are worked around below rather than
hidden:

1. No popularity / play-count metric. iTunes Search exposes nothing like
   Spotify's 0-100 popularity score, so this script builds a proxy score
   from how often/broadly a track surfaces across a basket of search
   queries and storefronts, with a small recency boost. Treat the
   "Popularity" column as "estimated relevance", not a real listen count.
2. No artist photos or follower counts. The public API returns track/album
   artwork only, not artist profile pictures. "Top 15 Artists" covers here
   fall back to the artist's best-scoring track artwork (upscaled) -- the
   same fallback path the front end already uses for missing images.
"""

import json
import os
import time
from datetime import datetime, timedelta

import requests
import gspread
from google.oauth2.service_account import Credentials

# ---------------------------------------------------------------------------
# Discovery & Filtering Configuration
# ---------------------------------------------------------------------------

DISCOVERY_QUERIES = [
    "ethiopian oldies",
    "ethiopian classics",
    "amharic oldies",
    "tilahun gessesse",
    "mahmoud ahmed",
    "alemayehu eshete",
    "mulatu astatke",
    "ethiopiques",
    "ethiopian pop",
    "amharic music",
    "habesha music",
    "aster aweke",
    "neway debebe",
    "gigi ethiopian singer",
    "ethiopian hip hop",
    "habesha hits",
    "tigrigna music",
    "oromo music",
    "eritrean music",
    "amharic hip hop",
    "rophnan",
    "kassmasse",
    "veronica adane",
    "ethiopian afrobeat",
    "teddy afro",
    "jano band",
]

# iTunes storefronts to search. Apple does not run separate Ethiopia/Eritrea
# App Store storefronts, so this searches storefronts with sizable Habesha
# diaspora populations plus the US catalog (which carries most
# internationally-distributed Ethiopian/Eritrean releases). Adjust this list
# if you find better coverage elsewhere -- it's a two-letter ISO code list.
ITUNES_STOREFRONTS = ["us", "se", "no", "il", "gb"]

HABESHA_KEYWORDS = [
    "ethio", "ethiopian", "eritrean", "habesha", "amharic",
    "tigrigna", "oromo", "gurage", "ethio-jazz", "ethiopiques",
]

SEED_ARTISTS = [
    "Tilahun Gessesse", "Mahmoud Ahmed", "Alemayehu Eshete", "Mulatu Astatke",
    "Aster Aweke", "Neway Debebe", "Gigi", "Teddy Afro", "Rophnan",
    "Kassmasse", "Veronica Adane", "Jano Band", "Betty G", "Sami Dan",
]

ARCHIVE_HEADERS = ["Date", "Track ID", "Artist", "Track Name", "Popularity"]

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"

# Be polite to the undocumented, unauthenticated iTunes rate limit.
REQUEST_DELAY_SECONDS = 0.6


def get_gspread_client():
    creds_json = os.environ.get("GCP_SA_KEY")
    if not creds_json:
        raise ValueError("Missing GCP_SA_KEY environment variable.")
    info = json.loads(creds_json)
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    return gspread.authorize(Credentials.from_service_account_info(info, scopes=scopes))


# ---------------------------------------------------------------------------
# iTunes Search API helpers
# ---------------------------------------------------------------------------

def itunes_request(params, retries=3):
    """GET against the iTunes Search API with basic retry/backoff."""
    for attempt in range(retries):
        try:
            resp = requests.get(ITUNES_SEARCH_URL, params=params, timeout=15)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (403, 429):
                time.sleep(2 * (attempt + 1))
                continue
            return None
        except requests.RequestException as e:
            print(f"iTunes request error: {e}")
            time.sleep(1.5 * (attempt + 1))
    return None


def search_tracks(term, storefront, limit=25):
    params = {
        "term": term,
        "media": "music",
        "entity": "song",
        "country": storefront,
        "limit": limit,
    }
    data = itunes_request(params)
    time.sleep(REQUEST_DELAY_SECONDS)
    if not data:
        return []
    return data.get("results", [])


def upsize_artwork(url, size=600):
    """iTunes artwork URLs default to 100x100; swap in a larger size."""
    if not url:
        return ""
    for token in ["100x100bb", "60x60bb", "30x30bb"]:
        if token in url:
            return url.replace(token, f"{size}x{size}bb")
    return url


# ---------------------------------------------------------------------------
# Strict Habesha Filtering
# ---------------------------------------------------------------------------

def is_habesha_result(item, verified_names):
    artist_name = (item.get("artistName") or "").lower()
    track_name = (item.get("trackName") or "").lower()
    collection = (item.get("collectionName") or "").lower()
    genre = (item.get("primaryGenreName") or "").lower()

    if artist_name in verified_names:
        return True
    if any(kw in artist_name for kw in HABESHA_KEYWORDS):
        return True
    if any(kw in genre for kw in HABESHA_KEYWORDS):
        return True
    if any(kw in track_name or kw in collection for kw in HABESHA_KEYWORDS):
        return True
    return False


def normalize_track(item):
    """Reshape an iTunes search result into the same generic track-dict
    shape the rest of the pipeline (and the Spotify version) expects:
    id / name / artists / album.images / album.release_date / popularity.
    """
    track_id = str(item.get("trackId", ""))
    artist_id = str(item.get("artistId", ""))
    artwork = upsize_artwork(item.get("artworkUrl100", ""))

    return {
        "id": track_id,
        "name": item.get("trackName", ""),
        "artists": [{"id": artist_id, "name": item.get("artistName", "")}],
        "album": {
            "images": [{"url": artwork}] if artwork else [],
            "release_date": (item.get("releaseDate") or "")[:10],
        },
        "popularity": 0,  # filled in by score_tracks()
        "_hit_count": 1,
    }


def score_tracks(tracks_by_id):
    """iTunes exposes no popularity/play-count signal, so this builds a
    0-100 proxy score from two observable things: how many discovery
    queries/storefronts turned the track up (a rough proxy for how
    prominent/well-tagged it is), and how recent the release is (a small
    boost so new releases aren't buried under old catalog tracks with many
    hits). Heuristic, not a real popularity metric.
    """
    if not tracks_by_id:
        return
    max_hits = max(t["_hit_count"] for t in tracks_by_id.values()) or 1

    for t in tracks_by_id.values():
        hit_score = (t["_hit_count"] / max_hits) * 85

        rel = t["album"].get("release_date") or ""
        recency_score = 0
        try:
            rel_date = datetime.strptime(rel, "%Y-%m-%d")
            days_old = (datetime.now() - rel_date).days
            recency_score = max(0, 15 - (days_old / 365.0) * 3)
        except ValueError:
            pass

        t["popularity"] = round(min(100, hit_score + recency_score))
        del t["_hit_count"]


# ---------------------------------------------------------------------------
# iTunes Discovery
# ---------------------------------------------------------------------------

def fetch_itunes_tracks():
    verified_names = {s.lower() for s in SEED_ARTISTS}
    tracks_by_id = {}

    print("Discovering Habesha tracks via iTunes Search API...")
    for term in DISCOVERY_QUERIES:
        for storefront in ITUNES_STOREFRONTS:
            results = search_tracks(term, storefront)
            for item in results:
                if not item.get("trackId"):
                    continue
                if not is_habesha_result(item, verified_names):
                    continue

                tid = str(item["trackId"])
                if tid in tracks_by_id:
                    tracks_by_id[tid]["_hit_count"] += 1
                else:
                    tracks_by_id[tid] = normalize_track(item)

    # Also pull each seed artist's own catalog directly, so well-known
    # artists aren't missed if a discovery query happens to miss them.
    print("Pulling seed artist catalogs...")
    for name in SEED_ARTISTS:
        results = search_tracks(name, "us", limit=50)
        for item in results:
            if not item.get("trackId"):
                continue
            if (item.get("artistName") or "").lower() not in verified_names:
                continue
            tid = str(item["trackId"])
            if tid in tracks_by_id:
                tracks_by_id[tid]["_hit_count"] += 1
            else:
                tracks_by_id[tid] = normalize_track(item)

    score_tracks(tracks_by_id)
    print(f"Filtered to {len(tracks_by_id)} verified Habesha tracks.")
    return list(tracks_by_id.values())


# ---------------------------------------------------------------------------
# Sheet-writing helpers (generic -- same shape as the Spotify version)
# ---------------------------------------------------------------------------

def ensure_archive_tab(sheet):
    try:
        ws = sheet.worksheet("Archive")
    except gspread.exceptions.WorksheetNotFound:
        ws = sheet.add_worksheet(title="Archive", rows="2000", cols="10")
        ws.append_row(ARCHIVE_HEADERS)
    return ws


def append_daily_snapshot(archive_ws, tracks):
    today_str = datetime.now().strftime("%Y-%m-%d")
    rows_to_append = []

    for t in tracks:
        artist_names = ", ".join([a["name"] for a in t.get("artists", [])])
        rows_to_append.append([
            today_str,
            t.get("id", ""),
            artist_names,
            t.get("name", ""),
            t.get("popularity", 0),
        ])

    if rows_to_append:
        archive_ws.append_rows(rows_to_append, value_input_option="USER_ENTERED")


def get_track_image_url(track):
    images = track.get("album", {}).get("images", [])
    return images[0].get("url", "") if images else ""


def parse_release_date(date_str):
    if not date_str:
        return datetime(2000, 1, 1)
    try:
        if len(date_str) == 4:
            return datetime.strptime(date_str, "%Y")
        elif len(date_str) == 7:
            return datetime.strptime(date_str, "%Y-%m")
        return datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        return datetime(2000, 1, 1)


def prepare_artist_leaderboard_rows(tracks, limit=15):
    """Apple's public API has no artist-photo or follower-count endpoint,
    so each artist's cover falls back to their highest-scored track's
    artwork, and the bio falls back to a tracked-count summary."""
    artist_counts = {}
    artist_track_images = {}

    for track in sorted(tracks, key=lambda x: x.get("popularity", 0), reverse=True):
        pop = track.get("popularity", 0)
        img_url = get_track_image_url(track)

        for artist in track.get("artists", []):
            aid = artist.get("id")
            name = artist.get("name")
            if not aid or not name:
                continue
            if aid not in artist_counts:
                artist_counts[aid] = {"name": name, "total_pop": 0, "count": 0}
                artist_track_images[aid] = img_url  # highest-scored track seen first
            artist_counts[aid]["total_pop"] += pop
            artist_counts[aid]["count"] += 1

    sorted_artists = sorted(
        artist_counts.items(),
        key=lambda x: (x[1]["total_pop"], x[1]["count"]),
        reverse=True
    )[:limit]

    rows = [["Rank", "Cover", "Artist", "Bio"]]

    for rank, (aid, data) in enumerate(sorted_artists, start=1):
        bio = f"Habesha Icon \u2022 {data['count']} tracks tracked"
        rows.append([rank, artist_track_images.get(aid, ""), data["name"], bio])

    return rows


def prepare_all_time_track_rows(tracks, limit=100):
    sorted_tracks = sorted(tracks, key=lambda x: x.get("popularity", 0), reverse=True)
    today_str = datetime.now().strftime("%Y-%m-%d")
    rows = [["Rank", "Cover", "Artist", "Track Name", "Track ID", "Popularity", "Score Growth", "Date"]]

    for rank, track in enumerate(sorted_tracks[:limit], start=1):
        artist_names = ", ".join([a["name"] for a in track.get("artists", [])])
        rows.append([
            rank,
            get_track_image_url(track),
            artist_names,
            track.get("name", ""),
            track.get("id", ""),
            track.get("popularity", 0),
            "+0",
            today_str,
        ])
    return rows


def calculate_timeframe_growth(archive_ws, current_tracks, days_back):
    all_records = archive_ws.get_all_records()
    today = datetime.now().date()
    target_date = today - timedelta(days=days_back)

    past_scores = {}
    best_deltas = {}

    for row in all_records:
        try:
            row_date = datetime.strptime(str(row.get("Date", "")), "%Y-%m-%d").date()
            track_id = str(row.get("Track ID", ""))
            pop = int(row.get("Popularity", 0))

            days_diff = abs((row_date - target_date).days)
            max_allowed_diff = max(2, min(14, days_back // 2))

            if days_diff <= max_allowed_diff:
                if track_id not in past_scores or days_diff < best_deltas[track_id]:
                    past_scores[track_id] = pop
                    best_deltas[track_id] = days_diff
        except (ValueError, TypeError, KeyError):
            continue

    has_archive_data = len(past_scores) > 0
    ranked_tracks = []
    now = datetime.now()

    for t in current_tracks:
        tid = t.get("id")
        curr_pop = t.get("popularity", 0)
        t_copy = dict(t)

        if has_archive_data and tid in past_scores:
            growth = curr_pop - past_scores[tid]
            t_copy["score"] = (float(growth), float(curr_pop))
            t_copy["growth_str"] = f"+{growth}" if growth > 0 else str(growth)
        else:
            rel_date = parse_release_date(t.get("album", {}).get("release_date"))
            days_old = (now - rel_date).days

            if days_back == 7:
                recency_weight = max(0.0, 100.0 - (days_old / 30.0))
                calc_score = curr_pop * 1.5 + recency_weight
            elif days_back == 30:
                recency_weight = max(0.0, 50.0 - (days_old / 90.0))
                calc_score = curr_pop + recency_weight
            elif days_back == 90:
                recency_weight = max(0.0, 25.0 - (days_old / 180.0))
                calc_score = curr_pop * 1.1 + recency_weight
            else:
                catalog_weight = min(30.0, days_old / 365.0)
                calc_score = curr_pop + catalog_weight

            t_copy["score"] = (float(calc_score), float(curr_pop))
            t_copy["growth_str"] = "+0"

        ranked_tracks.append(t_copy)

    ranked_tracks.sort(key=lambda x: x["score"], reverse=True)
    return ranked_tracks


def prepare_leaderboard_rows(tracks, limit=100):
    today_str = datetime.now().strftime("%Y-%m-%d")
    rows = [["Rank", "Cover", "Artist", "Track Name", "Track ID", "Popularity", "Score Growth", "Date"]]

    for rank, track in enumerate(tracks[:limit], start=1):
        artist_names = ", ".join([a["name"] for a in track.get("artists", [])])
        growth_str = track.get("growth_str", "+0")

        rows.append([
            rank,
            get_track_image_url(track),
            artist_names,
            track.get("name", ""),
            track.get("id", ""),
            track.get("popularity", 0),
            growth_str,
            today_str,
        ])
    return rows


def update_sheet_tab(sheet, tab_name, rows):
    try:
        try:
            worksheet = sheet.worksheet(tab_name)
        except gspread.exceptions.WorksheetNotFound:
            worksheet = sheet.add_worksheet(title=tab_name, rows="150", cols="10")

        worksheet.clear()
        worksheet.update(values=rows, range_name="A1")
        print(f"Updated '{tab_name}' tab with {len(rows)-1} items.")
    except Exception as e:
        print(f"Error updating '{tab_name}': {e}")


# ---------------------------------------------------------------------------
# Main Execution
# ---------------------------------------------------------------------------

def main():
    tracks = fetch_itunes_tracks()
    if not tracks:
        print("iTunes search returned 0 tracks. Aborting script.")
        return

    gc = get_gspread_client()
    sheet_id = os.environ.get(
        "SPREADSHEET_ID", "1PbFEMGn3XR3cnZXan04C65FdXPJbIVFAO_G51U9RGPU"
    )
    sheet = gc.open_by_key(sheet_id)

    archive_ws = ensure_archive_tab(sheet)
    append_daily_snapshot(archive_ws, tracks)

    # 1. Top 15 Artists
    artist_rows = prepare_artist_leaderboard_rows(tracks, limit=15)
    update_sheet_tab(sheet, "Top 15 Artists", artist_rows)

    # 2. All-Time Most Heard
    all_time_rows = prepare_all_time_track_rows(tracks, limit=100)
    update_sheet_tab(sheet, "All-Time Tracks", all_time_rows)

    # 3. Timeframe Growth Leaderboards
    timeframes = [
        ("Weekly Top 10", 7, 10),
        ("Monthly Top 100", 30, 100),
        ("3-Month Top 100", 90, 100),
        ("Yearly Top 100", 365, 100),
    ]

    for tab_name, days_back, limit in timeframes:
        ranked_tracks = calculate_timeframe_growth(archive_ws, tracks, days_back=days_back)
        rows = prepare_leaderboard_rows(ranked_tracks, limit=limit)
        update_sheet_tab(sheet, tab_name, rows)


if __name__ == "__main__":
    main()
