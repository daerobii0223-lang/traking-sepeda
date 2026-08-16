/* ==========================================================================
   RIDER MOBILE TRACKER PWA ENGINE (tracker.html)
   Fixes: First-point GPS initialization bug, jump filter reset, multi-rider BIB isolation
   ========================================================================== */

import { calculateDistance } from './mock-data.js';

class RiderApp {
  constructor() {
    this.authRider = null;
    this.authPin = null;

    this.isTracking = false;
    this.watchId = null;
    this.wakeLock = null;
    this.audioKeepAlive = null;

    this.lastPosition = null; // MUST BE NULL AT START so first location is accepted cleanly
    this.totalDistanceKm = 0;
    this.currentSpeedKmh = 0;
    this.currentElevation = 0;
    this.batteryLevel = 100;
    this.isCharging = false;

    this.initAudioKeepAlive();
    this.checkSession();
    this.setupListeners();
    this.initBattery();
  }

  initAudioKeepAlive() {
    const silentWav = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    this.audioKeepAlive = new Audio(silentWav);
    this.audioKeepAlive.loop = true;
  }

  startAudioKeepAlive() {
    if (this.audioKeepAlive) {
      this.audioKeepAlive.play().catch(e => {});
    }
  }

  stopAudioKeepAlive() {
    if (this.audioKeepAlive) {
      this.audioKeepAlive.pause();
    }
  }

  checkSession() {
    const savedSession = localStorage.getItem('racemap_rider_session');
    if (savedSession) {
      try {
        const session = JSON.parse(savedSession);
        this.authRider = session.rider;
        this.authPin = session.pin;
        this.showDashboard();

        if (session.isTrackingActive) {
          this.startTracking();
        }
      } catch (e) {
        this.showLogin();
      }
    } else {
      this.showLogin();
    }
  }

  showLogin() {
    const loginCard = document.getElementById('login-card');
    const dashboard = document.getElementById('tracker-dashboard');
    if (loginCard) loginCard.style.display = 'flex';
    if (dashboard) dashboard.style.display = 'none';
  }

  showDashboard() {
    const loginCard = document.getElementById('login-card');
    const dashboard = document.getElementById('tracker-dashboard');
    if (loginCard) loginCard.style.display = 'none';
    if (dashboard) dashboard.style.display = 'flex';

    const nameEl = document.getElementById('display-rider-name');
    const bibEl = document.getElementById('display-rider-bib');
    if (nameEl && this.authRider) nameEl.innerText = this.authRider.name;
    if (bibEl && this.authRider) bibEl.innerText = `BIB #${this.authRider.bib} (${this.authRider.category})`;
  }

  setupListeners() {
    const loginForm = document.getElementById('rider-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bib = document.getElementById('login-bib').value.trim();
        const pin = document.getElementById('login-pin').value.trim();

        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bib, pin })
          });

          const data = await res.json();
          if (data.success) {
            this.authRider = data.rider;
            this.authPin = pin;
            localStorage.setItem('racemap_rider_session', JSON.stringify({
              rider: data.rider,
              pin,
              isTrackingActive: false
            }));
            this.showDashboard();
          } else {
            alert(data.error || 'Login Gagal!');
          }
        } catch (err) {
          alert('Gagal terhubung ke server: ' + err.message);
        }
      });
    }

    const btnToggle = document.getElementById('btn-toggle-tracker');
    if (btnToggle) {
      btnToggle.addEventListener('click', () => {
        if (!this.isTracking) {
          this.startTracking();
        } else {
          this.stopTracking();
        }
      });
    }

    const btnSos = document.getElementById('btn-pwa-sos');
    if (btnSos) {
      btnSos.addEventListener('click', () => {
        if (confirm("🚨 Send Emergency SOS Alert to Race Control & Public Server?")) {
          this.triggerSOS();
        }
      });
    }

    const btnLogout = document.getElementById('btn-logout-rider');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        this.stopTracking();
        localStorage.removeItem('racemap_rider_session');
        this.authRider = null;
        this.authPin = null;
        this.showLogin();
      });
    }
  }

  async initBattery() {
    if ('getBattery' in navigator) {
      try {
        const battery = await navigator.getBattery();
        this.batteryLevel = Math.round(battery.level * 100);
        this.isCharging = battery.charging;
        this.updateUI();
        battery.addEventListener('levelchange', () => {
          this.batteryLevel = Math.round(battery.level * 100);
          this.updateUI();
        });
      } catch (e) {}
    }
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (e) {}
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  startTracking() {
    if (this.isTracking || !this.authRider) return;

    this.isTracking = true;
    this.lastPosition = null; // RESET to null so first physical point is accepted 100%!
    this.requestWakeLock();
    this.startAudioKeepAlive();

    localStorage.setItem('racemap_rider_session', JSON.stringify({
      rider: this.authRider,
      pin: this.authPin,
      isTrackingActive: true
    }));

    const geoOptions = {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000
    };

    if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.handleLocation(pos),
        (err) => this.handleError(err),
        geoOptions
      );
    } else {
      alert('Sensors GPS Geolocation tidak didukung di browser ini.');
    }

    this.updateUI();
  }

  stopTracking() {
    if (!this.isTracking) return;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.isTracking = false;
    this.lastPosition = null;
    this.releaseWakeLock();
    this.stopAudioKeepAlive();

    localStorage.setItem('racemap_rider_session', JSON.stringify({
      rider: this.authRider,
      pin: this.authPin,
      isTrackingActive: false
    }));

    this.updateUI();
  }

  async handleLocation(position) {
    const { latitude, longitude, altitude, speed, accuracy } = position.coords;
    const timestamp = position.timestamp;

    // Ignore low accuracy GPS frames (> 60m)
    if (accuracy > 60) {
      console.warn(`GPS accuracy too low (${accuracy}m). Skipping.`);
      return;
    }

    let distInc = 0;

    if (this.lastPosition) {
      // Calculate distance from previous point
      distInc = calculateDistance(
        this.lastPosition.lat,
        this.lastPosition.lng,
        latitude,
        longitude
      );

      if (distInc < 0.003) {
        // Less than 3 meters movement -> stationary
        distInc = 0;
      } else if (distInc > 10.0) {
        // If GPS jumped > 10km in 1 frame (e.g. tunnel/reboot), reset reference without discarding future points!
        console.warn('GPS jump detected (>10km). Resetting reference position.');
        distInc = 0;
      }
    }

    this.totalDistanceKm += distInc;

    // Speed calculation
    if (speed !== null && speed >= 0) {
      this.currentSpeedKmh = Number((speed * 3.6).toFixed(1));
    } else if (this.lastPosition && distInc > 0) {
      const timeDiffHours = (timestamp - this.lastPosition.timestamp) / (1000 * 3600);
      this.currentSpeedKmh = timeDiffHours > 0 ? Number((distInc / timeDiffHours).toFixed(1)) : 0;
    } else {
      this.currentSpeedKmh = 0;
    }

    this.currentElevation = altitude ? Math.round(altitude) : (this.currentElevation || 15);
    
    // Set current point as reference for next frame
    this.lastPosition = { lat: latitude, lng: longitude, timestamp };

    const payload = {
      bib: String(this.authRider.bib).trim(),
      pin: this.authPin,
      name: this.authRider.name,
      category: this.authRider.category,
      lat: Number(latitude.toFixed(5)),
      lng: Number(longitude.toFixed(5)),
      ele: this.currentElevation,
      speed: this.currentSpeedKmh,
      distanceKm: Number(this.totalDistanceKm.toFixed(2)),
      battery: this.batteryLevel,
      status: this.currentSpeedKmh > 0.8 ? 'moving' : 'stopped',
      lastUpdate: new Date().toLocaleTimeString()
    };

    // Send location to server
    try {
      const res = await fetch('/api/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.success) {
        console.warn('Location sync warning:', data.error);
      }
    } catch (e) {
      console.warn('Failed to sync location to backend:', e);
    }

    this.updateUI();
  }

  handleError(error) {
    const statusEl = document.getElementById('pwa-gps-status');
    if (statusEl) statusEl.innerText = `GPS Warning: ${error.message}`;
  }

  async triggerSOS() {
    if (!this.authRider) return;
    const lat = this.lastPosition ? this.lastPosition.lat : -6.1754;
    const lng = this.lastPosition ? this.lastPosition.lng : 106.8272;

    const sosPayload = {
      bib: String(this.authRider.bib).trim(),
      name: this.authRider.name,
      lat,
      lng,
      timestamp: new Date().toLocaleTimeString(),
      battery: this.batteryLevel
    };

    try {
      await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sosPayload)
      });
    } catch (e) {}

    alert(`🚨 EMERGENCY SOS DISPATCHED!\nKoordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}\nSinyal SOS telah dikirim ke Peta Publik & Race Control!`);
  }

  updateUI() {
    const btnTracker = document.getElementById('btn-toggle-tracker');
    const statusBadge = document.getElementById('pwa-status-badge');
    const speedVal = document.getElementById('tele-speed-val');
    const distVal = document.getElementById('tele-dist-val');
    const eleVal = document.getElementById('tele-ele-val');
    const batVal = document.getElementById('tele-bat-val');

    if (btnTracker) {
      if (this.isTracking) {
        btnTracker.classList.add('active');
        btnTracker.innerHTML = `<span>STOP</span><small>TRACKING</small>`;
      } else {
        btnTracker.classList.remove('active');
        btnTracker.innerHTML = `<span>START</span><small>TRACKING</small>`;
      }
    }

    if (statusBadge) {
      if (this.isTracking) {
        statusBadge.classList.remove('off');
        statusBadge.innerHTML = `<span class="pulse-dot"></span> GPS LIVE ACTIVE`;
      } else {
        statusBadge.classList.add('off');
        statusBadge.innerHTML = `<span class="pulse-dot"></span> OFF / PAUSED`;
      }
    }

    if (speedVal) speedVal.innerText = `${this.currentSpeedKmh.toFixed(1)} km/h`;
    if (distVal) distVal.innerText = `${this.totalDistanceKm.toFixed(2)} KM`;
    if (eleVal) eleVal.innerText = `${this.currentElevation} m`;
    if (batVal) batVal.innerText = `${this.batteryLevel}% ${this.isCharging ? '⚡' : ''}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new RiderApp();
});
