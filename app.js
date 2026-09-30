// Application State
let currentQuery = "Ethiopian Music";
let currentLimit = 12;
let currentlyPlayingBtn = null;

// DOM Elements
const audioPlayer = document.getElementById('audio-player');
const musicGrid = document.getElementById('music-grid');
const loader = document.getElementById('loader');
const sectionTitle = document.getElementById('section-title');

// Fetch data from iTunes API
async function fetchHabeshaMusic(term, limit = 12) {
  loader.classList.remove('hidden');
  musicGrid.innerHTML = '';

  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    renderMusicCards(data.results);
  } catch (error) {
    console.error('Error fetching iTunes data:', error);
    musicGrid.innerHTML = `<p class="col-span-full text-center text-red-400 py-10">Failed to load songs from iTunes. Please try again.</p>`;
  } finally {
    loader.classList.add('hidden');
  }
}

// Render Music Cards into the Grid
function renderMusicCards(tracks) {
  if (!tracks || tracks.length === 0) {
    musicGrid.innerHTML = `<p class="col-span-full text-center text-gray-400 py-10">No tracks found. Try searching for another artist!</p>`;
    return;
  }

  tracks.forEach((track, index) => {
    // Obtain high-res artwork URL (300x300)
    const artwork = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : 'https://via.placeholder.com/300';
    const releaseYear = track.releaseDate ? new Date(track.releaseDate).getFullYear() : 'N/A';

    const card = document.createElement('div');
    card.className = "group relative bg-cardBg rounded-xl overflow-hidden border border-gray-800/80 hover:border-gray-700 transition-all duration-300";
    
    card.innerHTML = `
      <div class="relative aspect-[1/1] overflow-hidden bg-gray-900">
        <!-- Rank Badge -->
        <span class="absolute top-2 left-2 z-10 bg-black/70 backdrop-blur-md text-brand font-black text-xs px-2 py-0.5 rounded border border-brand/30">
          #${index + 1}
        </span>

        <!-- Cover Image -->
        <img src="${artwork}" alt="${track.trackName}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />

        <!-- Hover Action Overlay -->
        <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-3">
          <div class="flex justify-end">
            <a href="${track.trackViewUrl}" target="_blank" title="View on iTunes" class="p-2 bg-black/60 hover:bg-brand hover:text-black rounded-full text-white transition">
              <i class="fa-brands fa-apple text-sm"></i>
            </a>
          </div>

          <!-- Play Preview Button -->
          <div class="flex justify-center">
            <button 
              data-preview="${track.previewUrl}" 
              class="play-btn p-3 bg-brand text-black rounded-full shadow-lg hover:scale-110 transition transform">
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

      <!-- Card Details -->
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

// Attach Event Listeners to Audio Play Buttons
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

// Search Form Handler
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const query = document.getElementById('search-input').value.trim();
  if (query) {
    currentQuery = query;
    sectionTitle.querySelector('span').textContent = `Search: "${query}"`;
    fetchHabeshaMusic(currentQuery, currentLimit);
  }
});

// Category Filter Buttons Handler
document.querySelectorAll('.pill-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-btn').forEach(b => {
      b.className = "pill-btn px-3 py-1.5 rounded-full text-gray-400 hover:text-white transition";
      b.classList.remove('active');
    });
    btn.className = "pill-btn active px-3 py-1.5 rounded-full bg-brand text-black font-semibold shadow-sm transition";

    currentQuery = btn.getAttribute('data-query');
    sectionTitle.querySelector('span').textContent = btn.textContent;
    fetchHabeshaMusic(currentQuery, currentLimit);
  });
});

// Limit Button Handler
document.querySelectorAll('.limit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.limit-btn').forEach(b => {
      b.className = "limit-btn px-3 py-1 text-gray-400 hover:text-white";
      b.classList.remove('active');
    });
    btn.className = "limit-btn active px-3 py-1 bg-gray-800 text-white rounded-md";

    currentLimit = parseInt(btn.getAttribute('data-limit'));
    fetchHabeshaMusic(currentQuery, currentLimit);
  });
});

// Reset play icon when audio finishes playing
audioPlayer.addEventListener('ended', () => {
  if (currentlyPlayingBtn) {
    currentlyPlayingBtn.querySelector('i').className = 'fa-solid fa-play text-lg translate-x-0.5';
  }
});

// Initial Fetch on Page Load
document.addEventListener('DOMContentLoaded', () => {
  fetchHabeshaMusic(currentQuery, currentLimit);
});
