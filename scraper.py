from datetime import datetime, timedelta
import json
import os
import re
import gspread
from google.oauth2.service_account import Credentials
import requests

# ---------------------------------------------------------------------------
# Configuration & Seed Words
# ---------------------------------------------------------------------------

DISCOVERY_QUERIES = [
    "ethiopian", "habesha", "amharic", "ethio-jazz", 
    "tigrigna", "oromo", "eritrean", "ethiopiques",
    "tilahun gessesse", "mahmoud ahmed", "aster aweke",
    "teddy afro", "rophnan", "kassmasse", "veronica adane"
]

HABESHA_KEYWORDS = [
    "ethio", "ethiopian", "eritrean", "habesha", "amharic", 
    "tigrigna", "oromo", "gurage", "ethio-jazz", "ethiopiques"
]

ARCHIVE_HEADERS = ["Date", "Track ID", "Artist", "Track Name", "Popularity"]


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


def get_hd_artwork(url_str):
    """Converts 100x100 iTunes thumbnail URLs into 600x600 HD artwork."""
    if not url_str:
        return ""
    return re.sub(r"/\d+x\d+bb\.jpg", "/600x600bb.jpg", url_str)


def is_habesha_entity(artist_name, track_name, genre=""):
    """Validates if the iTunes track or artist belongs to Habesha music."""
    combined = f"{artist_name} {track_name} {genre}".lower()
    return any(kw in combined for kw in HABESHA_KEYWORDS)


# ---------------------------------------------------------------------------
# iTunes Data Retrieval
# ---------------------------------------------------------------------------

def fetch_itunes_tracks():
    unique_tracks = {}
    track_occurrence_count = {}

    print("Fetching tracks from iTunes API...")
    for query in DISCOVERY_QUERIES:
        url = f"https://itunes.apple.com/search?term={query}&entity=song&limit=50"
        try:
            res = requests.get(url, timeout=10)
            if res.status_code != 200:
                continue
            data = res.json()
            
            for rank_idx, item in enumerate(data.get("results", [])):
                tid = str(item.get("trackId"))
                artist_name = item.get("artistName", "")
                track_name = item.get("trackName", "")
                genre = item.get("primaryGenreName", "")

                if not tid or not is_habesha_entity(artist_name, track_name, genre):
                    continue

                if tid not in unique_tracks:
                    unique_tracks[tid] = item
                    track_occurrence_count[tid] = 0

                # Search ranking weight (higher position in search = higher weight)
                track_occurrence_count[tid] += max(1, 50 - rank_idx)

        except Exception as e:
            print(f"Error fetching iTunes query '{query}': {e}")

    # Calculate synthetic popularity (0-100 scale) based on search presence
    if track_occurrence_count:
        max_score = max(track_occurrence_count.values())
        for tid, track in unique_tracks.items():
            raw_score = track_occurrence_count[tid]
            track["popularity"] = min(100, int((raw_score / max_score) * 100))

    print(f"Discovered {len(unique_tracks)} verified Habesha tracks on iTunes.")
    return list(unique_tracks.values())


# ---------------------------------------------------------------------------
# Leaderboards & Storage
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
    rows = []
    for t in tracks:
        rows.append([
            today_str,
            str(t.get("trackId", "")),
            t.get("artistName", ""),
            t.get("trackName", ""),
            t.get("popularity", 0)
        ])
    if rows:
        archive_ws.append_rows(rows, value_input_option="USER_ENTERED")


def prepare_artist_leaderboard_rows(tracks, limit=15):
    artist_data = {}

    for t in tracks:
        aid = str(t.get("artistId", t.get("artistName")))
        aname = t.get("artistName", "")
        pop = t.get("popularity", 0)
        img = get_hd_artwork(t.get("artworkUrl100", ""))
        genre = t.get("primaryGenreName", "Habesha Music")

        if aid not in artist_data:
            artist_data[aid] = {
                "name": aname,
                "total_pop": 0,
                "count": 0,
                "image": img,
                "genre": genre
            }
        artist_data[aid]["total_pop"] += pop
        artist_data[aid]["count"] += 1

    sorted_artists = sorted(
        artist_data.values(),
        key=lambda x: (x["total_pop"], x["count"]),
        reverse=True
    )[:limit]

    rows = [["Rank", "Cover", "Artist", "Bio"]]
    for rank, a in enumerate(sorted_artists, start=1):
        bio = f"{a['genre']} • {a['count']} tracks on iTunes"
        rows.append([rank, a["image"], a["name"], bio])

    return rows


def prepare_track_rows(tracks, limit=100):
    sorted_tracks = sorted(tracks, key=lambda x: x.get("popularity", 0), reverse=True)
    today_str = datetime.now().strftime("%Y-%m-%d")
    rows = [["Rank", "Cover", "Artist", "Track Name", "Track ID", "Popularity", "Score Growth", "Date"]]

    for rank, t in enumerate(sorted_tracks[:limit], start=1):
        rows.append([
            rank,
            get_hd_artwork(t.get("artworkUrl100", "")),
            t.get("artistName", ""),
            t.get("trackName", ""),
            str(t.get("trackId", "")),
            t.get("popularity", 0),
            "+0",
            today_str
        ])
    return rows


def update_sheet_tab(sheet, tab_name, rows):
    try:
        try:
            ws = sheet.worksheet(tab_name)
        except gspread.exceptions.WorksheetNotFound:
            ws = sheet.add_worksheet(title=tab_name, rows="150", cols="10")
        ws.clear()
        ws.update(values=rows, range_name="A1")
        print(f"Updated '{tab_name}' with {len(rows)-1} entries.")
    except Exception as e:
        print(f"Error updating '{tab_name}': {e}")


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def main():
    tracks = fetch_itunes_tracks()
    if not tracks:
        print("No iTunes tracks returned.")
        return

    gc = get_gspread_client()
    sheet_id = os.environ.get("SPREADSHEET_ID", "1PbFEMGn3XR3cnZXan04C65FdXPJbIVFAO_G51U9RGPU")
    sheet = gc.open_by_key(sheet_id)

    archive_ws = ensure_archive_tab(sheet)
    append_daily_snapshot(archive_ws, tracks)

    # Top 15 Artists
    artist_rows = prepare_artist_leaderboard_rows(tracks, limit=15)
    update_sheet_tab(sheet, "Top 15 Artists", artist_rows)

    # Track Leaderboards
    track_rows = prepare_track_rows(tracks, limit=100)
    update_sheet_tab(sheet, "All-Time Tracks", track_rows)
    update_sheet_tab(sheet, "Weekly Top 10", track_rows[:11])
    update_sheet_tab(sheet, "Monthly Top 100", track_rows)


if __name__ == "__main__":
    main()
