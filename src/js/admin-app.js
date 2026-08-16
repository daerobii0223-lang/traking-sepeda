/* ==========================================================================
   ADMIN RACE CONTROL PORTAL ENGINE (admin.html)
   Handles Admin Login (admin/admin), Rider Generator, GPX Manager & Race Control
   ========================================================================== */

import { generateFullRoutePoints, calculateDistance } from './mock-data.js';

class AdminApp {
  constructor() {
    this.simInterval = null;
    this.isSimulating = false;
    this.simRoutePoints = generateFullRoutePoints();

    this.checkAdminSession();
    this.setupAdminLogin();
  }

  checkAdminSession() {
    const token = sessionStorage.getItem('racemap_admin_token');
    const loginCard = document.getElementById('admin-login-card');
    const dashboard = document.getElementById('admin-dashboard-container');

    if (token === 'admin-authenticated-session-888') {
      if (loginCard) loginCard.style.display = 'none';
      if (dashboard) dashboard.style.display = 'block';

      this.fetchRiders();
      this.setupForm();
      this.setupListeners();
    } else {
      if (loginCard) loginCard.style.display = 'flex';
      if (dashboard) dashboard.style.display = 'none';
    }
  }

  setupAdminLogin() {
    const loginForm = document.getElementById('admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('admin-user-input').value.trim();
        const password = document.getElementById('admin-pass-input').value.trim();

        try {
          const res = await fetch('/api/auth/admin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });

          const data = await res.json();
          if (data.success) {
            sessionStorage.setItem('racemap_admin_token', data.token);
            this.checkAdminSession();
          } else {
            alert(data.error || 'Login Admin Gagal!');
          }
        } catch (err) {
          alert('Error: ' + err.message);
        }
      });
    }

    const btnLogout = document.getElementById('btn-admin-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        sessionStorage.removeItem('racemap_admin_token');
        this.checkAdminSession();
      });
    }
  }

  async fetchRiders() {
    try {
      const res = await fetch('/api/riders');
      const riders = await res.json();
      this.renderRidersTable(riders);
    } catch (err) {
      console.error('Failed to fetch riders:', err);
    }
  }

  renderRidersTable(riders) {
    const tbody = document.getElementById('admin-riders-table-body');
    if (!tbody) return;

    if (!riders || riders.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="padding:1rem; text-align:center; color:var(--text-dim);">
            Belum ada akun peserta terdaftar. Buat akun baru di atas!
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    riders.forEach(r => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      tr.innerHTML = `
        <td style="padding:0.6rem;"><span class="rider-bib">${r.bib}</span></td>
        <td style="padding:0.6rem; font-weight:700;">${r.name}</td>
        <td style="padding:0.6rem; color:var(--text-muted);">${r.category || 'Solo'}</td>
        <td style="padding:0.6rem; font-family:monospace; color:var(--primary); font-weight:700;">${r.pin || '****'}</td>
        <td style="padding:0.6rem; font-family:monospace;">${r.distanceKm || 0} KM</td>
        <td style="padding:0.6rem;">
          <button class="btn-delete-rider" data-bib="${r.bib}" style="background:rgba(244,63,94,0.15); color:#fda4af; border:1px solid rgba(244,63,94,0.3); padding:0.25rem 0.5rem; border-radius:5px; font-size:0.65rem; cursor:pointer;">
            🗑️ Hapus
          </button>
        </td>
      `;

      const btnDelete = tr.querySelector('.btn-delete-rider');
      btnDelete.addEventListener('click', () => this.deleteRider(r.bib));

      tbody.appendChild(tr);
    });
  }

  setupForm() {
    const createForm = document.getElementById('create-rider-form');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bib = document.getElementById('admin-bib').value.trim();
        const pin = document.getElementById('admin-pin').value.trim();
        const name = document.getElementById('admin-name').value.trim();
        const category = document.getElementById('admin-category').value;

        try {
          const res = await fetch('/api/admin/riders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bib, pin, name, category })
          });

          const data = await res.json();
          if (data.success) {
            alert(`✅ Akun Rider BIB #${bib} (${name}) Berhasil Dibuat!\nPIN Login: ${pin}`);
            createForm.reset();
            this.fetchRiders();
          } else {
            alert(data.error || 'Gagal membuat akun.');
          }
        } catch (err) {
          alert('Error: ' + err.message);
        }
      });
    }
  }

  setupListeners() {
    const modeSelect = document.getElementById('admin-event-mode');
    if (modeSelect) {
      modeSelect.addEventListener('change', async (e) => {
        const mode = e.target.value;
        try {
          await fetch('/api/admin/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
          });
          alert(`✅ Mode Balapan diubah ke: ${mode.toUpperCase()}`);
        } catch (err) {}
      });
    }

    const gpxInput = document.getElementById('admin-gpx-input');
    if (gpxInput) {
      gpxInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => this.parseGPXFile(event.target.result);
          reader.readAsText(file);
        }
      });
    }

    const btnSim = document.getElementById('btn-toggle-sim');
    if (btnSim) {
      btnSim.addEventListener('click', () => {
        if (this.isSimulating) {
          this.stopSimulation();
        } else {
          this.startSimulation();
        }
      });
    }

    const btnClear = document.getElementById('btn-clear-event');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        if (confirm("⚠️ APAKAH ANDA YAKIN INGIN MENGAPUS SELURUH AKUN PESERTA & HASIL RACE INI? Action ini tidak bisa dibatalkan!")) {
          try {
            await fetch('/api/admin/clear', { method: 'POST' });
            alert("🧹 Seluruh data event & peserta berhasil dibersihkan.");
            this.fetchRiders();
          } catch (err) {}
        }
      });
    }
  }

  async deleteRider(bib) {
    if (confirm(`Hapus akun peserta BIB #${bib}?`)) {
      try {
        await fetch(`/api/admin/riders/${bib}`, { method: 'DELETE' });
        this.fetchRiders();
      } catch (err) {}
    }
  }

  parseGPXFile(fileText) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(fileText, "text/xml");
      const trackPoints = xmlDoc.getElementsByTagName("trkpt");
      const parsedPoints = [];
      let totalDist = 0;

      for (let i = 0; i < trackPoints.length; i++) {
        const pt = trackPoints[i];
        const lat = parseFloat(pt.getAttribute("lat"));
        const lng = parseFloat(pt.getAttribute("lon"));
        const eleNode = pt.getElementsByTagName("ele")[0];
        const ele = eleNode ? parseFloat(eleNode.textContent) : 0;

        if (parsedPoints.length > 0) {
          const prev = parsedPoints[parsedPoints.length - 1];
          totalDist += calculateDistance(prev.lat, prev.lng, lat, lng);
        }

        parsedPoints.push({
          lat: Number(lat.toFixed(5)),
          lng: Number(lng.toFixed(5)),
          ele: Math.round(ele),
          dist: Number(totalDist.toFixed(1))
        });
      }

      if (parsedPoints.length > 0) {
        fetch('/api/admin/gpx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routePoints: parsedPoints })
        });
        alert(`✅ Rute GPX berhasil di-upload ke server!\nTotal Trackpoints: ${parsedPoints.length}\nTotal Jarak: ${totalDist.toFixed(1)} KM`);
      } else {
        alert("Tidak ada <trkpt> dalam file GPX.");
      }
    } catch (err) {
      alert("Error parsing GPX: " + err.message);
    }
  }

  startSimulation() {
    this.isSimulating = true;
    const btnSim = document.getElementById('btn-toggle-sim');
    if (btnSim) {
      btnSim.innerText = '🛑 STOP SIMULATOR';
      btnSim.classList.remove('btn-primary');
      btnSim.classList.add('btn-secondary');
    }

    const demoRiders = [
      { bib: '888', name: 'Demo Rider 1', category: 'Solo Unsupported', index: 50 },
      { bib: '889', name: 'Demo Rider 2', category: 'Pair Category', index: 20 }
    ];

    this.simInterval = setInterval(() => {
      demoRiders.forEach(r => {
        r.index += 2;
        if (r.index >= this.simRoutePoints.length) r.index = 0;
        const pt = this.simRoutePoints[r.index];

        fetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bib: r.bib,
            name: r.name,
            category: r.category,
            lat: pt.lat,
            lng: pt.lng,
            ele: pt.ele,
            speed: 26.5,
            distanceKm: pt.dist,
            battery: 95,
            status: 'moving'
          })
        });
      });
      this.fetchRiders();
    }, 2000);
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.isSimulating = false;
    const btnSim = document.getElementById('btn-toggle-sim');
    if (btnSim) {
      btnSim.innerText = '▶ START SIMULATOR DEMO';
      btnSim.classList.add('btn-primary');
      btnSim.classList.remove('btn-secondary');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new AdminApp();
});
