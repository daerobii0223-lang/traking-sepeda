/* ==========================================================================
   RACE CONTROL & ADMIN DASHBOARD ENGINE
   Handles GPX File Upload, Rider Fleet Manager, Live Race Simulator, & GPX Exporter
   ========================================================================== */

import { generateFullRoutePoints, calculateDistance } from './mock-data.js';

export class RaceAdminEngine {
  constructor(appState) {
    this.appState = appState;
    this.simInterval = null;
    this.simSpeed = 1;
    this.isSimulating = false;

    this.routePoints = generateFullRoutePoints();
  }

  // Parse Uploaded GPX File (XML parser)
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
        this.routePoints = parsedPoints;
        this.appState.updateCustomRoute(parsedPoints);
        alert(`✅ File GPX Berhasil Di-upload!\nTotal Trackpoints: ${parsedPoints.length}\nTotal Jarak: ${totalDist.toFixed(1)} KM`);
      } else {
        alert("⚠️ Tidak ditemukan koordinat <trkpt> dalam file GPX.");
      }
    } catch (err) {
      alert("❌ Gagal membaca file GPX: " + err.message);
    }
  }

  // Start 5-Rider Live Simulation Demo
  startSimulation(speedMultiplier = 1) {
    if (this.isSimulating) {
      this.stopSimulation();
    }

    this.simSpeed = speedMultiplier;
    this.isSimulating = true;
    
    // Assign progress index for each rider on the route
    const simRiders = [
      { id: "rider-101", bib: "101", name: "Raden Mas (Solo)", speed: 28.5, index: 120, battery: 92, category: "Solo Unsupported" },
      { id: "rider-107", bib: "107", name: "Kartika Sari (Solo)", speed: 24.2, index: 95, battery: 85, category: "Solo Unsupported" },
      { id: "rider-204", bib: "204", name: "Budi & Siska (Pair)", speed: 22.0, index: 70, battery: 78, category: "Pair Category" },
      { id: "rider-305", bib: "305", name: "Doni Ultra (Solo)", speed: 30.1, index: 140, battery: 95, category: "Solo Unsupported" },
      { id: "rider-402", bib: "402", name: "Team Fast (Relay)", speed: 32.4, index: 180, battery: 99, category: "Relay Team" }
    ];

    const broadcast = new BroadcastChannel('racemap_live_stream');

    this.simInterval = setInterval(() => {
      simRiders.forEach(r => {
        // Advance point index
        r.index += Math.floor(Math.random() * 3) + 1;
        if (r.index >= this.routePoints.length) {
          r.index = this.routePoints.length - 1;
        }

        const point = this.routePoints[r.index];
        const randomSpeedNoise = (Math.random() * 4 - 2);
        const currentSpeed = Number((r.speed + randomSpeedNoise).toFixed(1));

        // Slowly decrease battery
        if (Math.random() > 0.8 && r.battery > 5) r.battery -= 1;

        const payload = {
          type: 'LOCATION_UPDATE',
          id: r.id,
          bib: r.bib,
          name: r.name,
          category: r.category,
          lat: point.lat,
          lng: point.lng,
          ele: point.ele,
          speed: Math.max(0, currentSpeed),
          distanceKm: point.dist,
          battery: r.battery,
          status: 'moving',
          lastUpdate: new Date().toLocaleTimeString(),
          accuracy: 5
        };

        // Broadcast to app state
        broadcast.postMessage(payload);
        this.appState.handleLiveLocationUpdate(payload);
      });
    }, 2000 / this.simSpeed);

    this.updateSimUI();
  }

  stopSimulation() {
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.isSimulating = false;
    this.updateSimUI();
  }

  updateSimUI() {
    const btnSim = document.getElementById('btn-toggle-sim');
    if (btnSim) {
      if (this.isSimulating) {
        btnSim.classList.remove('btn-primary');
        btnSim.classList.add('btn-secondary');
        btnSim.innerText = '🛑 STOP SIMULASI';
      } else {
        btnSim.classList.add('btn-primary');
        btnSim.classList.remove('btn-secondary');
        btnSim.innerText = '▶ START 5-RIDER SIMULATION';
      }
    }
  }

  // Export Rider's Tracked Breadcrumbs to GPX XML format
  exportRiderGPX(rider) {
    if (!rider || !rider.trail || rider.trail.length === 0) {
      alert("⚠️ Peserta belum memiliki jejak lintasan untuk di-export.");
      return;
    }

    let gpxXml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    gpxXml += `<gpx version="1.1" creator="Racemap Ultra App">\n`;
    gpxXml += `  <metadata>\n    <name>Jejak ${rider.name} (BIB #${rider.bib})</name>\n  </metadata>\n`;
    gpxXml += `  <trk>\n    <name>${rider.name} Track</name>\n    <trkseg>\n`;

    rider.trail.forEach(pt => {
      gpxXml += `      <trkpt lat="${pt.lat}" lon="${pt.lng}"></trkpt>\n`;
    });

    gpxXml += `    </trkseg>\n  </trk>\n</gpx>`;

    // Trigger File Download
    const blob = new Blob([gpxXml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jejak-rider-${rider.bib}-${rider.name.replace(/\s+/g, '_')}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
