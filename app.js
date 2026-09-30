// Application State
let currentFilter = "all-time"; // Options: top-15-artists, all-time, weekly, monthly, quarterly, yearly
let currentlyPlayingBtn = null;

// DOM Elements
const audioPlayer = document.getElementById('audio-player');
const musicGrid = document.getElementById('music-grid');
const loader = document.getElementById('loader');
const sectionTitle = document.getElementById('section-title');

// REPLACE WITH YOUR GOOGLE SHEETS / WEB APP API ENDPOINT
const GOOGLE_SHEETS_ENDPOINT = "YOUR_GOOGLE_SHEETS_API_URL_HERE";

// Top 15 Habesha Artists List
const TOP_15_ARTISTS = [
  "Aster Aweke", "Teddy Afro", "Rophnan", "Gigi", "Tilahun Gessesse",
  "Mahmoud Ahmed", "Mulatu Astatke", "Gossaye Tesfaye", "Veronica Adane",
  "Sileshi Demissie", "Abinet Agonafir", "Ephrem Tamiru", "Jbo Jay",
  "Betty G", "Dan Admasu"
];

// Fetch Rankings from Google Sheets
async function fetchSheetRankings(timeframe) {
  try {
    const response = await fetch(`${GOOGLE_SHEETS_ENDPOINT}?timeframe=${timeframe}`);
    const sheetData = await response.json();
    return sheetData; // Expected format: [{ trackId: "123456" }, ...] or [{ artistName: "...", trackName: "..." }]
  } catch (error) {
    console.error('Error fetching Google Sheets data:', error);
    return [];
  }
}

// Fetch Full Metadata from iTunes Lookup API using Track IDs
async function fetchiTunesDetailsByIds(trackIds) {
  if (!trackIds || trackIds.length === 0) return [];
  
  const idsString = trackIds.join(',');
  const url = `https://itunes.apple.com/lookup?id=${idsString}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('Error fetching iTunes lookup details:', error);
    return [];
  }
}

// Fetch Tracks for Specific Artists via iTunes Search
async function fetchTracksForArtists(artistList, limitPerArtist = 3) {
  try {
    const promises = artistList.map(artist =>
      fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=song&limit=${limitPerArtist}`)
        .then(res => res.json())
        .then(data => data.results || [])
    );

    const resultsArray = await Promise.all(promises);
    let allTracks = resultsArray.flat();
    return Array.from(new Map(allTracks.map(track => [track.trackId, track])).values());
  } catch (error) {
    console.error('Error fetching artist search:', error);
    return [];
  }
}

// Main Filter Handler
async function loadFilterData(filterType) {
  currentFilter = filterType;
  loader.classList.remove('hidden');
  musicGrid.innerHTML = '';

  let tracks = [];

  switch (filterType) {
    case 'top-15-artists':
      sectionTitle.querySelector('span').textContent = 'Top 15 Habesha Artists';
      tracks = await fetchTracksForArtists(TOP_15_ARTISTS, 5);
      break;

    case 'all-time':
      sectionTitle.querySelector('span').textContent = 'All-Time Top 15 Tracks';
      // Fetch Track IDs for 'all-time' from Google Sheets
      const allTimeData = await fetchSheetRankings('all-time');
      const allTimeIds = allTimeData.map(item => item.trackId);
      tracks = await fetchiTunesDetailsByIds(allTimeIds);
      break;

    case 'weekly':
      sectionTitle.querySelector('span').textContent = 'Weekly Top 10';
      const weeklyData = await fetchSheetRankings('weekly');
      const weeklyIds = weeklyData.slice(0, 10).map(item => item.trackId);
      tracks = await fetchiTunesDetailsByIds(weeklyIds);
      break;

    case 'monthly':
      sectionTitle.querySelector('span').textContent = 'Monthly Top 100';
      const monthlyData = await fetchSheetRankings('monthly');
      const monthlyIds = monthlyData.slice(0, 100).map(item => item.trackId);
      tracks = await fetchiTunesDetailsByIds(monthlyIds);
      break;

    case 'quarterly':
      sectionTitle.querySelector('span').textContent = 'Quarterly Top 100';
      const quarterlyData = await fetchSheetRankings('quarterly');
      const quarterlyIds = quarterlyData.slice(0, 100).map(item => item.trackId);
      tracks = await fetchiTunesDetailsByIds(quarterlyIds);
      break;

    case 'yearly':
      sectionTitle.querySelector('span').textContent = 'Yearly Top 100';
      const yearlyData = await fetchSheetRankings('yearly');
      const yearlyIds = yearlyData.slice(0, 100).map(item => item.trackId);
      tracks = await fetchiTunesDetailsByIds(yearlyIds);
      break;

    default:
      tracks = await fetchTracksForArtists(["Ethiopian Music"], 15);
  }

  loader.classList.add('hidden');
  renderMusicCards(tracks);
}

// Render Music Cards Grid
function renderMusicCards(tracks) {
  musicGrid.innerHTML = '';

  if (!tracks || tracks.length === 0) {
    musicGrid.innerHTML = `<p class="col-span-full text-center text-gray-400 py-10">No tracks available for this section.</p>`;
    return;
  }

  tracks.forEach((track, index) => {
    const artwork = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : 'https://via.placeholder.com/300';
    const releaseYear = track.releaseDate ? new Date(track.releaseDate).getFullYear() : 'N/A';

    const card = document.createElement('div');
    card.className = "group relative bg-cardBg rounded-xl overflow-hidden border border-gray-800/80 hover:border-gray-700 transition-all duration-300";
    
    card.innerHTML = `
      <div class="relative aspect-[1/1] overflow-hidden bg-gray-900">
        <span class="absolute top-2 left-2 z-10 bg-black/70 backdrop-blur-md text-brand font-black text-xs px-2 py-0.5 rounded border border-brand/30">
          #${index + 1}
        </span>
        <img src="${artwork}" alt="${track.trackName}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-3">
          <div class="flex justify-end">
            <a href="${track.trackViewUrl}" target="_blank" title="View on iTunes" class="p-2 bg-black/60 hover:bg-brand hover:text-black rounded-full text-white transition">
              <i class="fa-brands fa-apple text-sm"></i>
            </a>
          </div>
          <div class="flex justify-center">
            <button data-preview="${track.previewUrl}" class="play-btn p-3 bg-brand text-black rounded-full shadow-lg hover:scale-110 transition transform">
              <i class="fa-solid fa-play text-lg translate-x-0.5"></i>
            </button>
          </div>
          <div class="text-right">
            <span class="text-[10px] bg-black/70 px-2 py-1 rounded text-gray-300 font-medium">
              ${track.primaryGenreName || 'Habesha'}
            </span>
          </div>
        </div>
      </div>
      <div class="p-3">
        <h3 class="text-sm font-semibold truncate text-gray-100 group-hover:text-brand transition-colors" title="${track.trackName}">
          ${track.trackName}
        </h3>
        <p class="text-xs text-gray-400 mt-0.5 truncate">${track.artistName}</p>
        <p class="text-[11px] text-gray-500 mt-1 flex items-center justify-between">
          <span>${releaseYear}</span>
          <span class="text-brand font-medium">${track.trackPrice > 0 ? '$' + track.trackPrice : 'iTunes'}</span>
        </p>
      </div>
    `;

    musicGrid.appendChild(card);
  });

  attachPlayListeners();
}

// Audio Play Listeners
function attachPlayListeners() {
  document.querySelectorAll('.play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const previewUrl = btn.getAttribute('data-preview');
      const icon = btn.querySelector('i');

      if (audioPlayer.src === previewUrl && !audioPlayer.paused) {
        audioPlayer.pause();
        icon.className = 'fa-solid fa-play text-lg translate-x-0.5';
      } else {
        if (currentlyPlayingBtn) {
          currentlyPlayingBtn.querySelector('i').className = 'fa-solid fa-play text-lg translate-x-0.5';
        }
        audioPlayer.src = previewUrl;
        audioPlayer.play();
        icon.className = 'fa-solid fa-pause text-lg';
        currentlyPlayingBtn = btn;
      }
    });
  });
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  loadFilterData('all-time');
});
