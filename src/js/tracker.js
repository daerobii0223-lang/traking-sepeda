/* ==========================================================================
   RIDER MOBILE GPS TRACKER PWA ENGINE
   Handles Geolocation Watcher, WakeLock, Battery API, Offline Buffer, & Backend Sync
   ========================================================================== */

import { calculateDistance } from './mock-data.js';

export class RiderTrackerEngine {
  constructor() {
    this.isTracking = false;
    this.watchId = null;
    this.wakeLock = null;
    this.riderProfile = {
      bib: "777",
      name: "Saya (Rider HP)",
      category: "Solo Unsupported"
    };
    
    this.lastPosition = null;
    this.totalDistanceKm = 0;
    this.currentSpeedKmh = 0;
    this.currentElevation = 0;
    this.heading = 0;
    this.batteryLevel = 100;
    this.isCharging = false;
    this.offlineQueue = [];
    
    this.broadcastChannel = new BroadcastChannel('racemap_live_stream');
    
    this.initBatteryListener();
    this.loadOfflineQueue();
  }

  async initBatteryListener() {
    if ('getBattery' in navigator) {
      try {
        const battery = await navigator.getBattery();
        this.updateBatteryInfo(battery);
        battery.addEventListener('levelchange', () => this.updateBatteryInfo(battery));
        battery.addEventListener('chargingchange', () => this.updateBatteryInfo(battery));
      } catch (err) {}
    }
  }

  updateBatteryInfo(battery) {
    this.batteryLevel = Math.round(battery.level * 100);
    this.isCharging = battery.charging;
    this.updateUI();
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (err) {}
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  startTracking(riderBib = "777", riderName = "HP Tracker") {
    if (this.isTracking) return;
    
    this.riderProfile.bib = riderBib;
    this.riderProfile.name = riderName;
    this.isTracking = true;
    this.requestWakeLock();

    const geoOptions = {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    };

    if ('geolocation' in navigator) {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.handleLocationSuccess(pos),
        (err) => this.handleLocationError(err),
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
    this.releaseWakeLock();
    this.updateUI();
  }

  handleLocationSuccess(position) {
    const { latitude, longitude, altitude, speed, heading, accuracy } = position.coords;
    const timestamp = position.timestamp;

    if (accuracy > 50) return;

    let distInc = 0;
    if (this.lastPosition) {
      distInc = calculateDistance(
        this.lastPosition.lat,
        this.lastPosition.lng,
        latitude,
        longitude
      );

      if (distInc < 0.005) {
        distInc = 0;
      } else if (distInc > 5.0) {
        return;
      }
    }

    this.totalDistanceKm += distInc;
    
    if (speed !== null && speed >= 0) {
      this.currentSpeedKmh = Number((speed * 3.6).toFixed(1));
    } else if (this.lastPosition && distInc > 0) {
      const timeDiffHours = (timestamp - this.lastPosition.timestamp) / (1000 * 3600);
      this.currentSpeedKmh = Number((distInc / timeDiffHours).toFixed(1));
    } else {
      this.currentSpeedKmh = 0;
    }

    this.currentElevation = altitude ? Math.round(altitude) : 15;
    this.heading = heading || 0;

    const payload = {
      type: 'LOCATION_UPDATE',
      id: `rider-${this.riderProfile.bib}`,
      bib: this.riderProfile.bib,
      name: this.riderProfile.name,
      category: this.riderProfile.category,
      lat: Number(latitude.toFixed(5)),
      lng: Number(longitude.toFixed(5)),
      ele: this.currentElevation,
      speed: this.currentSpeedKmh,
      distanceKm: Number(this.totalDistanceKm.toFixed(2)),
      battery: this.batteryLevel,
      status: this.currentSpeedKmh > 1.0 ? 'moving' : 'stopped',
      lastUpdate: new Date().toLocaleTimeString(),
      accuracy: Math.round(accuracy)
    };

    this.lastPosition = { lat: latitude, lng: longitude, timestamp };

    this.broadcastUpdate(payload);
    this.updateUI(payload);
  }

  handleLocationError(error) {
    const errEl = document.getElementById('pwa-gps-status');
    if (errEl) errEl.innerText = `GPS Error: ${error.message}`;
  }

  async broadcastUpdate(payload) {
    // 1. Broadcast locally across tabs
    this.broadcastChannel.postMessage(payload);
    localStorage.setItem('racemap_last_rider_update', JSON.stringify(payload));

    // 2. Post to Public Backend Server DB
    if (navigator.onLine) {
      try {
        await fetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (this.offlineQueue.length > 0) {
          this.flushOfflineQueue();
        }
      } catch (err) {
        this.offlineQueue.push(payload);
        this.saveOfflineQueue();
      }
    } else {
      this.offlineQueue.push(payload);
      this.saveOfflineQueue();
    }
  }

  saveOfflineQueue() {
    localStorage.setItem('racemap_offline_queue', JSON.stringify(this.offlineQueue));
  }

  loadOfflineQueue() {
    const saved = localStorage.getItem('racemap_offline_queue');
    if (saved) {
      try {
        this.offlineQueue = JSON.parse(saved);
      } catch (e) {
        this.offlineQueue = [];
      }
    }
  }

  async flushOfflineQueue() {
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    localStorage.removeItem('racemap_offline_queue');

    for (const item of queue) {
      try {
        await fetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
      } catch (e) {}
    }
  }

  async triggerSOS() {
    const lat = this.lastPosition ? this.lastPosition.lat : -6.1754;
    const lng = this.lastPosition ? this.lastPosition.lng : 106.8272;

    const sosPayload = {
      type: 'SOS_ALERT',
      bib: this.riderProfile.bib,
      name: this.riderProfile.name,
      lat,
      lng,
      timestamp: new Date().toLocaleTimeString(),
      battery: this.batteryLevel
    };

    this.broadcastChannel.postMessage(sosPayload);
    
    try {
      await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sosPayload)
      });
    } catch (e) {}

    alert(`🚨 SOS DISPATCHED!\nKoordinat: ${lat.toFixed(5)}, ${lng.toFixed(5)}\nSinyal telah dikirimkan ke server publik & Race Control!`);
  }

  updateUI(payload = null) {
    const btnTracker = document.getElementById('btn-toggle-tracker');
    const statusBadge = document.getElementById('pwa-status-badge');
    const speedVal = document.getElementById('tele-speed-val');
    const distVal = document.getElementById('tele-dist-val');
    const eleVal = document.getElementById('tele-ele-val');
    const batVal = document.getElementById('tele-bat-val');
    const queueVal = document.getElementById('tele-queue-val');

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
    if (queueVal) queueVal.innerText = `${this.offlineQueue.length} queued`;
  }
}
