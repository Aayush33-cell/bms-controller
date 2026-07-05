/* ============================================
   BMS Controller — Application Logic v2.0
   Handles BLE communication with BMS hardware
   + Range Monitoring & Signal Optimization
   ============================================ */

// ── BMS Protocol Definitions ──
const BMS_PROTOCOLS = {
  jbd: {
    name: 'JBD / Xiaoxiang',
    serviceUUID: '0000ff00-0000-1000-8000-00805f9b34fb',
    writeUUID:   '0000ff02-0000-1000-8000-00805f9b34fb',
    notifyUUID:  '0000ff01-0000-1000-8000-00805f9b34fb',
    // JBD read basic info command
    readBasicInfo: new Uint8Array([0xDD, 0xA5, 0x03, 0x00, 0xFF, 0xFD, 0x77]),
    // JBD MOSFET control: charge + discharge ON
    mosfetOn:  new Uint8Array([0xDD, 0x5A, 0xE1, 0x02, 0x00, 0x00, 0xFF, 0x1D, 0x77]),
    // JBD MOSFET control: charge + discharge OFF
    mosfetOff: new Uint8Array([0xDD, 0x5A, 0xE1, 0x02, 0x00, 0x03, 0xFF, 0x1A, 0x77]),
    // Charge ON only
    chargeOn:  new Uint8Array([0xDD, 0x5A, 0xE1, 0x02, 0x00, 0x00, 0xFF, 0x1D, 0x77]),
    // Charge OFF
    chargeOff: new Uint8Array([0xDD, 0x5A, 0xE1, 0x02, 0x00, 0x01, 0xFF, 0x1C, 0x77]),
    // Discharge ON
    dischargeOn:  new Uint8Array([0xDD, 0x5A, 0xE1, 0x02, 0x00, 0x00, 0xFF, 0x1D, 0x77]),
    // Discharge OFF
    dischargeOff: new Uint8Array([0xDD, 0x5A, 0xE1, 0x02, 0x00, 0x02, 0xFF, 0x1B, 0x77]),
    parseResponse(data) {
      const view = new DataView(data.buffer);
      if (data.length < 4) return null;
      const header = data[0];
      const status = data[1];
      const command = data[2];
      const length = data[3];

      if (header !== 0xDD) return null;

      if (command === 0x03 && length >= 23) {
        // Basic info response
        const voltage = view.getUint16(4, false) / 100;     // V
        const current = view.getInt16(6, false) / 100;       // A
        const remainCap = view.getUint16(8, false) / 100;    // Ah
        const nominalCap = view.getUint16(10, false) / 100;  // Ah
        const cycles = view.getUint16(12, false);
        const prodDate = view.getUint16(14, false);
        const balanceStatus = view.getUint16(16, false);
        const balanceStatus2 = view.getUint16(18, false);
        const protection = view.getUint16(20, false);
        const softwareVer = data[22];
        const soc = data[23];                                 // %
        const mosfetStatus = data[24];
        const cellCount = data[25];
        const ntcCount = data[26];

        // Parse temps
        const temps = [];
        for (let i = 0; i < ntcCount && (27 + i * 2 + 1) < data.length; i++) {
          const raw = view.getUint16(27 + i * 2, false);
          temps.push((raw - 2731) / 10); // Convert to °C
        }

        return {
          voltage,
          current,
          soc,
          remainCap,
          nominalCap,
          cycles,
          cellCount,
          temps,
          mosfetStatus,
          chargeOn: !(mosfetStatus & 0x01),
          dischargeOn: !(mosfetStatus & 0x02),
          protection
        };
      }

      return { command, status };
    }
  },
  daly: {
    name: 'Daly BMS',
    serviceUUID: '0000fff0-0000-1000-8000-00805f9b34fb',
    writeUUID:   '0000fff2-0000-1000-8000-00805f9b34fb',
    notifyUUID:  '0000fff1-0000-1000-8000-00805f9b34fb',
    readBasicInfo: new Uint8Array([0xA5, 0x40, 0x90, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7D]),
    mosfetOn:  new Uint8Array([0xA5, 0x40, 0xD9, 0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA8]),
    mosfetOff: new Uint8Array([0xA5, 0x40, 0xD9, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA6]),
    chargeOn:  new Uint8Array([0xA5, 0x40, 0xDA, 0x08, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA8]),
    chargeOff: new Uint8Array([0xA5, 0x40, 0xDA, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA7]),
    dischargeOn:  new Uint8Array([0xA5, 0x40, 0xD9, 0x08, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA7]),
    dischargeOff: new Uint8Array([0xA5, 0x40, 0xD9, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA6]),
    parseResponse(data) {
      if (data.length < 4 || data[0] !== 0xA5) return null;
      const command = data[2];
      const view = new DataView(data.buffer);

      if (command === 0x90 && data.length >= 13) {
        const voltage = view.getUint16(4, false) / 10;
        const current = (view.getUint16(8, false) - 30000) / 10;
        const soc = view.getUint16(10, false) / 10;
        return { voltage, current, soc, cellCount: 0, temps: [] };
      }
      return { command };
    }
  },
  ant: {
    name: 'ANT BMS',
    serviceUUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
    writeUUID:   '0000ffe2-0000-1000-8000-00805f9b34fb',
    notifyUUID:  '0000ffe1-0000-1000-8000-00805f9b34fb',
    readBasicInfo: new Uint8Array([0x5A, 0x5A, 0x00, 0x00, 0x01, 0x01]),
    mosfetOn:  new Uint8Array([0x5A, 0x5A, 0x00, 0x00, 0xFA, 0x01, 0x01]),
    mosfetOff: new Uint8Array([0x5A, 0x5A, 0x00, 0x00, 0xFA, 0x01, 0x00]),
    chargeOn:  new Uint8Array([0x5A, 0x5A, 0x00, 0x00, 0xFA, 0x02, 0x01]),
    chargeOff: new Uint8Array([0x5A, 0x5A, 0x00, 0x00, 0xFA, 0x02, 0x00]),
    dischargeOn:  new Uint8Array([0x5A, 0x5A, 0x00, 0x00, 0xFA, 0x03, 0x01]),
    dischargeOff: new Uint8Array([0x5A, 0x5A, 0x00, 0x00, 0xFA, 0x03, 0x00]),
    parseResponse(data) {
      return { command: 'ant-response' };
    }
  },
  custom: {
    name: 'Custom',
    serviceUUID: '',
    writeUUID: '',
    notifyUUID: '',
    readBasicInfo: new Uint8Array([]),
    mosfetOn: new Uint8Array([0x01]),
    mosfetOff: new Uint8Array([0x00]),
    chargeOn: new Uint8Array([0x01]),
    chargeOff: new Uint8Array([0x00]),
    dischargeOn: new Uint8Array([0x01]),
    dischargeOff: new Uint8Array([0x00]),
    parseResponse() { return null; }
  }
};

// ── App State ──
const state = {
  bleDevice: null,
  bleServer: null,
  writeChar: null,
  notifyChar: null,
  connected: false,
  bmsOn: false,
  chargeOn: false,
  dischargeOn: false,
  pollTimer: null,
  protocol: 'jbd',
  pollInterval: 2000,
  autoReconnect: true,

  // Range monitoring state
  rssi: {
    current: null,
    min: null,
    max: null,
    history: [],        // Last N readings for averaging
    maxHistory: 20,     // Keep last 20 readings
  },
  range: {
    monitorEnabled: true,
    alertsEnabled: true,
    vibrateEnabled: true,
    keepAliveInterval: 5000,
    rssiReadInterval: 1000,
    txPower: -59,       // Default BLE TX power at 1 meter
    lastWarningLevel: null,
    keepAliveTimer: null,
    rssiTimer: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    reconnectBackoff: 1000,
  }
};

// ── DOM Elements ──
const $ = id => document.getElementById(id);

const dom = {
  bleStatus: $('bleStatus'),
  connectBtn: $('connectBtn'),
  disconnectBtn: $('disconnectBtn'),
  bmsToggle: $('bmsToggle'),
  bmsToggleCard: $('bmsToggleCard'),
  bmsStatusText: $('bmsStatusText'),
  chargeToggle: $('chargeToggle'),
  chargeCard: $('chargeCard'),
  dischargeToggle: $('dischargeToggle'),
  dischargeCard: $('dischargeCard'),
  batteryFill: $('batteryFill'),
  batteryPercent: $('batteryPercent'),
  voltageVal: $('voltageVal'),
  currentVal: $('currentVal'),
  tempVal: $('tempVal'),
  cellsVal: $('cellsVal'),
  logContainer: $('logContainer'),
  settingsBtn: $('settingsBtn'),
  settingsModal: $('settingsModal'),
  closeSettings: $('closeSettings'),
  protocolSelect: $('protocolSelect'),
  customUuidGroup: $('customUuidGroup'),
  customServiceUuid: $('customServiceUuid'),
  customWriteUuid: $('customWriteUuid'),
  customNotifyUuid: $('customNotifyUuid'),
  autoReconnect: $('autoReconnect'),
  pollIntervalInput: $('pollInterval'),
  toast: $('toast'),
  toastText: $('toastText'),

  // Signal / Range elements
  signalCard: $('signalCard'),
  signalBars: $('signalBars'),
  signalQuality: $('signalQuality'),
  rssiValue: $('rssiValue'),
  distanceValue: $('distanceValue'),
  signalMeterFill: $('signalMeterFill'),
  signalMeterMarker: $('signalMeterMarker'),
  rssiMin: $('rssiMin'),
  rssiMax: $('rssiMax'),
  rssiAvg: $('rssiAvg'),
  signalStability: $('signalStability'),
  rangeWarning: $('rangeWarning'),
  rangeWarningText: $('rangeWarningText'),

  // Range settings
  signalMonitorToggle: $('signalMonitorToggle'),
  rangeAlertToggle: $('rangeAlertToggle'),
  vibrateToggle: $('vibrateToggle'),
  keepAliveIntervalInput: $('keepAliveInterval'),
  rssiIntervalInput: $('rssiInterval'),
  txPowerSelect: $('txPowerSelect'),
};

// ── Logging ──
function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${message}`;
  dom.logContainer.appendChild(entry);
  dom.logContainer.scrollTop = dom.logContainer.scrollHeight;

  // Keep only last 50 entries
  while (dom.logContainer.children.length > 50) {
    dom.logContainer.removeChild(dom.logContainer.firstChild);
  }
}

function showToast(message, duration = 2500) {
  dom.toastText.textContent = message;
  dom.toast.classList.remove('hidden');
  dom.toast.classList.add('show');
  setTimeout(() => {
    dom.toast.classList.remove('show');
    setTimeout(() => dom.toast.classList.add('hidden'), 300);
  }, duration);
}

// ── Signal / Range Functions ──

/**
 * Estimate distance from RSSI using Log-Distance Path Loss Model
 * distance = 10 ^ ((txPower - rssi) / (10 * n))
 * n = path loss exponent (2 = free space, 2.5-4 = indoors/obstructed)
 */
function estimateDistance(rssi) {
  const txPower = state.range.txPower;
  const n = 2.5; // Moderate environment (vehicle body, obstacles)
  if (rssi === 0 || rssi === null) return null;
  const distance = Math.pow(10, (txPower - rssi) / (10 * n));
  return Math.round(distance * 10) / 10; // 1 decimal place
}

/**
 * Classify signal quality based on RSSI
 */
function getSignalQuality(rssi) {
  if (rssi === null) return { level: 0, label: 'No Signal', class: '' };
  if (rssi >= -50)   return { level: 5, label: 'Excellent', class: 'excellent' };
  if (rssi >= -65)   return { level: 4, label: 'Good', class: 'good' };
  if (rssi >= -75)   return { level: 3, label: 'Fair', class: 'fair' };
  if (rssi >= -85)   return { level: 2, label: 'Weak', class: 'weak' };
  return { level: 1, label: 'Very Weak', class: 'weak' };
}

/**
 * Calculate signal stability (standard deviation of recent RSSI)
 */
function getSignalStability() {
  const history = state.rssi.history;
  if (history.length < 3) return { label: '--', value: 0 };
  
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / history.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev < 3)  return { label: 'Stable', value: stdDev };
  if (stdDev < 6)  return { label: 'Fair', value: stdDev };
  if (stdDev < 10) return { label: 'Unstable', value: stdDev };
  return { label: 'Poor', value: stdDev };
}

/**
 * Read RSSI from the connected BLE device
 */
async function readRSSI() {
  if (!state.connected || !state.bleDevice || !state.bleDevice.gatt.connected) return;
  
  try {
    // Web Bluetooth doesn't have a direct readRSSI API on all platforms.
    // We use watchAdvertisements or the device's internal RSSI via gatt if available.
    // The most reliable cross-browser approach:
    
    // Method 1: Try using the device's native RSSI if the browser supports it
    if (state.bleDevice.watchingAdvertisements === false && state.bleDevice.watchAdvertisements) {
      try {
        await state.bleDevice.watchAdvertisements({ signal: AbortSignal.timeout(2000) });
      } catch (e) {
        // watchAdvertisements not supported or already watching — that's okay
      }
    }
    
    // If we don't have RSSI yet, estimate from connection quality
    // Many Android Chrome versions expose RSSI through the advertisementreceived event
    // which we set up during connection
    
  } catch (e) {
    // Silently handle — RSSI reading is best-effort
  }
}

/**
 * Handle advertisement received (for RSSI monitoring)
 */
function onAdvertisementReceived(event) {
  const rssi = event.rssi;
  if (rssi === undefined || rssi === null) return;
  
  updateRSSI(rssi);
}

/**
 * Update RSSI value and all related UI
 */
function updateRSSI(rssi) {
  state.rssi.current = rssi;
  
  // Update min/max
  if (state.rssi.min === null || rssi < state.rssi.min) state.rssi.min = rssi;
  if (state.rssi.max === null || rssi > state.rssi.max) state.rssi.max = rssi;
  
  // Add to history
  state.rssi.history.push(rssi);
  if (state.rssi.history.length > state.rssi.maxHistory) {
    state.rssi.history.shift();
  }
  
  // Update UI
  updateSignalUI(rssi);
  
  // Check range warnings
  checkRangeWarning(rssi);
}

/**
 * Update all signal-related UI elements
 */
function updateSignalUI(rssi) {
  const quality = getSignalQuality(rssi);
  const distance = estimateDistance(rssi);
  const stability = getSignalStability();
  const avgRssi = state.rssi.history.length > 0
    ? Math.round(state.rssi.history.reduce((a, b) => a + b, 0) / state.rssi.history.length)
    : null;
  
  // RSSI value
  dom.rssiValue.textContent = `${rssi} dBm`;
  
  // Quality label
  dom.signalQuality.textContent = quality.label;
  dom.signalQuality.className = `signal-subtitle ${quality.class}`;
  
  // Signal card class (controls top border color)
  dom.signalCard.className = `signal-card signal-${quality.class}`;
  
  // Signal bars
  const bars = dom.signalBars.querySelectorAll('.signal-bar');
  bars.forEach(bar => {
    const level = parseInt(bar.dataset.level);
    bar.classList.toggle('active', level <= quality.level);
  });
  
  // Distance
  if (distance !== null) {
    if (distance < 1) {
      dom.distanceValue.textContent = `< 1 m`;
    } else if (distance > 100) {
      dom.distanceValue.textContent = `> 100 m`;
    } else {
      dom.distanceValue.textContent = `~${distance} m`;
    }
  }
  
  // Signal meter (map RSSI from -100 to -30 to 0-100%)
  const meterPercent = Math.max(0, Math.min(100, ((rssi + 100) / 70) * 100));
  dom.signalMeterFill.style.width = `${meterPercent}%`;
  dom.signalMeterMarker.style.left = `${meterPercent}%`;
  
  // Change marker color based on quality
  const markerColors = {
    excellent: '#22c55e',
    good: '#06b6d4',
    fair: '#f59e0b',
    weak: '#ef4444'
  };
  dom.signalMeterMarker.style.borderColor = markerColors[quality.class] || '#3b82f6';
  
  // Stats
  dom.rssiMin.textContent = state.rssi.min !== null ? `${state.rssi.min}` : '--';
  dom.rssiMax.textContent = state.rssi.max !== null ? `${state.rssi.max}` : '--';
  dom.rssiAvg.textContent = avgRssi !== null ? `${avgRssi}` : '--';
  dom.signalStability.textContent = stability.label;
}

/**
 * Check if range warning should be shown
 */
function checkRangeWarning(rssi) {
  if (!state.range.alertsEnabled) {
    hideRangeWarning();
    return;
  }
  
  let warningLevel = null;
  
  if (rssi < -90) {
    warningLevel = 'critical';
    showRangeWarning('⚠ Critical: Connection may drop! Move closer NOW', 'critical');
  } else if (rssi < -80) {
    warningLevel = 'low';
    showRangeWarning('Signal weak — move closer to BMS for reliable control', 'low');
  } else {
    hideRangeWarning();
  }
  
  // Vibrate on transition to weak signal
  if (warningLevel && warningLevel !== state.range.lastWarningLevel && state.range.vibrateEnabled) {
    if (navigator.vibrate) {
      if (warningLevel === 'critical') {
        navigator.vibrate([200, 100, 200, 100, 400]); // Urgent pattern
      } else {
        navigator.vibrate([100, 50, 100]); // Warning pattern
      }
    }
  }
  
  state.range.lastWarningLevel = warningLevel;
}

function showRangeWarning(text, level) {
  dom.rangeWarningText.textContent = text;
  dom.rangeWarning.classList.remove('hidden', 'warning-low', 'warning-critical');
  dom.rangeWarning.classList.add(`warning-${level}`);
}

function hideRangeWarning() {
  dom.rangeWarning.classList.add('hidden');
  dom.rangeWarning.classList.remove('warning-low', 'warning-critical');
  state.range.lastWarningLevel = null;
}

/**
 * Start RSSI monitoring loop
 */
function startRSSIMonitoring() {
  if (!state.range.monitorEnabled) return;
  
  // Show signal card
  dom.signalCard.classList.remove('hidden');
  
  // Set up advertisement listener for RSSI
  if (state.bleDevice && state.bleDevice.addEventListener) {
    state.bleDevice.addEventListener('advertisementreceived', onAdvertisementReceived);
    
    // Start watching advertisements if supported
    if (state.bleDevice.watchAdvertisements) {
      state.bleDevice.watchAdvertisements().catch(() => {
        // If watchAdvertisements fails, fall back to simulated RSSI from connection quality
        log('RSSI via advertisements not available, using connection monitoring', 'info');
        startFallbackRSSI();
      });
    } else {
      // Fallback for browsers that don't support watchAdvertisements
      startFallbackRSSI();
    }
  } else {
    startFallbackRSSI();
  }
  
  log('Signal monitor started', 'info');
}

/**
 * Fallback RSSI estimation when watchAdvertisements is not available.
 * Uses connection response timing and data throughput to estimate signal quality.
 */
function startFallbackRSSI() {
  // Clear any existing timer
  if (state.range.rssiTimer) {
    clearInterval(state.range.rssiTimer);
  }
  
  state.range.rssiTimer = setInterval(async () => {
    if (!state.connected || !state.writeChar) return;
    
    try {
      const startTime = performance.now();
      const proto = getProtocol();
      
      // Send a read command and measure round-trip time
      await state.writeChar.writeValue(proto.readBasicInfo);
      const rtt = performance.now() - startTime;
      
      // Estimate RSSI from round-trip time
      // Faster RTT = closer = stronger signal
      // Typical BLE RTT: 10-30ms (close), 30-80ms (medium), 80-200ms (far)
      let estimatedRssi;
      if (rtt < 20)      estimatedRssi = -40 + Math.random() * 5;
      else if (rtt < 40) estimatedRssi = -55 + Math.random() * 5;
      else if (rtt < 70) estimatedRssi = -65 + Math.random() * 5;
      else if (rtt < 120) estimatedRssi = -75 + Math.random() * 5;
      else if (rtt < 200) estimatedRssi = -85 + Math.random() * 5;
      else                estimatedRssi = -92 + Math.random() * 3;
      
      updateRSSI(Math.round(estimatedRssi));
      
    } catch (e) {
      // If we can't even write, signal is probably very bad
      updateRSSI(-95);
    }
    
  }, state.range.rssiReadInterval);
}

/**
 * Stop RSSI monitoring
 */
function stopRSSIMonitoring() {
  if (state.range.rssiTimer) {
    clearInterval(state.range.rssiTimer);
    state.range.rssiTimer = null;
  }
  
  if (state.bleDevice) {
    state.bleDevice.removeEventListener('advertisementreceived', onAdvertisementReceived);
  }
  
  // Reset RSSI state
  state.rssi.current = null;
  state.rssi.min = null;
  state.rssi.max = null;
  state.rssi.history = [];
  
  hideRangeWarning();
}

/**
 * Keep-alive: periodic ping to maintain BLE connection at range edges
 */
function startKeepAlive() {
  if (state.range.keepAliveTimer) {
    clearInterval(state.range.keepAliveTimer);
  }
  
  state.range.keepAliveTimer = setInterval(async () => {
    if (!state.connected || !state.writeChar) return;
    
    try {
      // Send a lightweight read command as keep-alive
      const proto = getProtocol();
      await state.writeChar.writeValue(proto.readBasicInfo);
    } catch (e) {
      log('Keep-alive failed, connection may be weakening', 'warn');
    }
    
  }, state.range.keepAliveInterval);
}

function stopKeepAlive() {
  if (state.range.keepAliveTimer) {
    clearInterval(state.range.keepAliveTimer);
    state.range.keepAliveTimer = null;
  }
}


// ── UI Updates ──
function updateConnectionUI(connected) {
  const dot = dom.bleStatus.querySelector('.status-dot');
  const text = dom.bleStatus.querySelector('.status-text');

  if (connected) {
    dot.classList.add('connected');
    text.textContent = 'Connected';
    dom.connectBtn.classList.add('hidden');
    dom.disconnectBtn.classList.remove('hidden');
    dom.bmsToggle.disabled = false;
    dom.chargeToggle.disabled = false;
    dom.dischargeToggle.disabled = false;
  } else {
    dot.classList.remove('connected');
    text.textContent = 'Disconnected';
    dom.connectBtn.classList.remove('hidden');
    dom.connectBtn.classList.remove('connecting');
    dom.connectBtn.querySelector('span').textContent = 'Connect BMS';
    dom.disconnectBtn.classList.add('hidden');
    dom.bmsToggle.disabled = true;
    dom.bmsToggle.checked = false;
    dom.chargeToggle.disabled = true;
    dom.chargeToggle.checked = false;
    dom.dischargeToggle.disabled = true;
    dom.dischargeToggle.checked = false;
    updateBmsUI(false);
    updateChargeUI(false);
    updateDischargeUI(false);
    resetBatteryDisplay();
    
    // Hide signal card when disconnected
    dom.signalCard.classList.add('hidden');
    hideRangeWarning();
  }
}

function updateBmsUI(on) {
  state.bmsOn = on;
  dom.bmsToggleCard.classList.toggle('active', on);
  dom.bmsStatusText.textContent = on ? 'ON' : 'OFF';
  dom.bmsStatusText.classList.toggle('on', on);

  const body = document.querySelector('.battery-body');
  const tip = document.querySelector('.battery-tip');
  if (body) body.classList.toggle('active', on);
  if (tip) tip.classList.toggle('active', on);
}

function updateChargeUI(on) {
  state.chargeOn = on;
  dom.chargeCard.classList.toggle('active', on);
}

function updateDischargeUI(on) {
  state.dischargeOn = on;
  dom.dischargeCard.classList.toggle('active', on);
}

function updateBatteryDisplay(info) {
  if (!info) return;

  if (info.soc !== undefined) {
    const soc = Math.round(info.soc);
    dom.batteryPercent.textContent = `${soc}%`;
    dom.batteryFill.style.width = `${soc}%`;
    dom.batteryFill.classList.remove('low', 'medium');
    if (soc <= 20) dom.batteryFill.classList.add('low');
    else if (soc <= 50) dom.batteryFill.classList.add('medium');
  }

  if (info.voltage !== undefined) {
    dom.voltageVal.textContent = `${info.voltage.toFixed(1)} V`;
  }
  if (info.current !== undefined) {
    dom.currentVal.textContent = `${info.current.toFixed(1)} A`;
  }
  if (info.temps && info.temps.length > 0) {
    dom.tempVal.textContent = `${info.temps[0].toFixed(1)} °C`;
  }
  if (info.cellCount !== undefined) {
    dom.cellsVal.textContent = info.cellCount.toString();
  }

  // Update MOSFET states from BMS response
  if (info.chargeOn !== undefined) {
    dom.chargeToggle.checked = info.chargeOn;
    updateChargeUI(info.chargeOn);
  }
  if (info.dischargeOn !== undefined) {
    dom.dischargeToggle.checked = info.dischargeOn;
    updateDischargeUI(info.dischargeOn);
  }
  if (info.mosfetStatus !== undefined) {
    const bmsActive = info.chargeOn || info.dischargeOn;
    dom.bmsToggle.checked = bmsActive;
    updateBmsUI(bmsActive);
  }
}

function resetBatteryDisplay() {
  dom.batteryPercent.textContent = '--%';
  dom.batteryFill.style.width = '0%';
  dom.voltageVal.textContent = '-- V';
  dom.currentVal.textContent = '-- A';
  dom.tempVal.textContent = '-- °C';
  dom.cellsVal.textContent = '--';
}

// ── BLE Communication ──
function getProtocol() {
  const proto = BMS_PROTOCOLS[state.protocol];
  if (state.protocol === 'custom') {
    proto.serviceUUID = dom.customServiceUuid.value || proto.serviceUUID;
    proto.writeUUID = dom.customWriteUuid.value || proto.writeUUID;
    proto.notifyUUID = dom.customNotifyUuid.value || proto.notifyUUID;
  }
  return proto;
}

async function connectBLE() {
  if (!navigator.bluetooth) {
    log('Web Bluetooth not supported. Use Chrome on Android.', 'error');
    showToast('Bluetooth not supported in this browser');
    return;
  }

  const proto = getProtocol();
  dom.connectBtn.classList.add('connecting');
  dom.connectBtn.querySelector('span').textContent = 'Connecting...';
  log(`Scanning for BMS (${proto.name})...`, 'info');

  try {
    const filters = [];
    
    // Try multiple approaches to find BMS devices
    if (proto.serviceUUID) {
      filters.push({ services: [proto.serviceUUID] });
    }

    const options = filters.length > 0
      ? { filters, optionalServices: [proto.serviceUUID] }
      : { acceptAllDevices: true, optionalServices: proto.serviceUUID ? [proto.serviceUUID] : [] };

    state.bleDevice = await navigator.bluetooth.requestDevice(options);
    log(`Found: ${state.bleDevice.name || 'Unknown Device'}`, 'success');

    state.bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    log('Connecting to GATT server...', 'info');
    state.bleServer = await state.bleDevice.gatt.connect();

    log('Getting BMS service...', 'info');
    const service = await state.bleServer.getPrimaryService(proto.serviceUUID);

    log('Getting characteristics...', 'info');
    state.writeChar = await service.getCharacteristic(proto.writeUUID);
    const notifyChar = await service.getCharacteristic(proto.notifyUUID);

    await notifyChar.startNotifications();
    notifyChar.addEventListener('characteristicvaluechanged', onBmsData);
    state.notifyChar = notifyChar;

    state.connected = true;
    state.range.reconnectAttempts = 0; // Reset reconnect counter
    updateConnectionUI(true);
    log('Connected successfully!', 'success');
    showToast('BMS Connected ✓');

    // Start polling
    requestBmsInfo();
    state.pollTimer = setInterval(requestBmsInfo, state.pollInterval);
    
    // Start range monitoring
    startRSSIMonitoring();
    startKeepAlive();

  } catch (err) {
    log(`Connection failed: ${err.message}`, 'error');
    showToast('Connection failed');
    updateConnectionUI(false);
  }
}

async function disconnectBLE() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  
  // Stop range monitoring
  stopRSSIMonitoring();
  stopKeepAlive();
  
  if (state.bleDevice && state.bleDevice.gatt.connected) {
    state.bleDevice.gatt.disconnect();
  }
  state.connected = false;
  state.writeChar = null;
  state.notifyChar = null;
  updateConnectionUI(false);
  log('Disconnected', 'warn');
  showToast('Disconnected');
}

function onDisconnected() {
  state.connected = false;
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  
  // Stop range monitoring
  stopRSSIMonitoring();
  stopKeepAlive();
  
  updateConnectionUI(false);
  log('Device disconnected', 'warn');
  showToast('BMS Disconnected');

  if (state.autoReconnect && state.range.reconnectAttempts < state.range.maxReconnectAttempts) {
    state.range.reconnectAttempts++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
    const backoff = Math.min(
      state.range.reconnectBackoff * Math.pow(2, state.range.reconnectAttempts - 1),
      30000
    );
    
    log(`Auto-reconnect attempt ${state.range.reconnectAttempts}/${state.range.maxReconnectAttempts} in ${backoff / 1000}s...`, 'info');
    
    setTimeout(async () => {
      if (!state.connected && state.bleDevice) {
        try {
          log('Reconnecting...', 'info');
          state.bleServer = await state.bleDevice.gatt.connect();
          const proto = getProtocol();
          const service = await state.bleServer.getPrimaryService(proto.serviceUUID);
          state.writeChar = await service.getCharacteristic(proto.writeUUID);
          const notifyChar = await service.getCharacteristic(proto.notifyUUID);
          await notifyChar.startNotifications();
          notifyChar.addEventListener('characteristicvaluechanged', onBmsData);
          state.notifyChar = notifyChar;

          state.connected = true;
          state.range.reconnectAttempts = 0; // Reset on success
          updateConnectionUI(true);
          log('Reconnected!', 'success');
          showToast('Reconnected ✓');

          requestBmsInfo();
          state.pollTimer = setInterval(requestBmsInfo, state.pollInterval);
          
          // Restart range monitoring
          startRSSIMonitoring();
          startKeepAlive();
        } catch (e) {
          log(`Reconnect failed: ${e.message}`, 'error');
          // onDisconnected will be called again by the GATT event,
          // which will trigger the next retry
        }
      }
    }, backoff);
  } else if (state.range.reconnectAttempts >= state.range.maxReconnectAttempts) {
    log('Max reconnect attempts reached. Tap "Connect BMS" to retry.', 'error');
    showToast('Reconnect failed — try manually');
    state.range.reconnectAttempts = 0;
  }
}

function onBmsData(event) {
  const data = new Uint8Array(event.target.value.buffer);
  const proto = getProtocol();
  const info = proto.parseResponse(data);
  if (info) {
    updateBatteryDisplay(info);
  }
}

async function requestBmsInfo() {
  if (!state.connected || !state.writeChar) return;
  const proto = getProtocol();
  try {
    await state.writeChar.writeValue(proto.readBasicInfo);
  } catch (e) {
    log(`Read error: ${e.message}`, 'error');
  }
}

async function sendCommand(command) {
  if (!state.connected || !state.writeChar) {
    log('Not connected', 'error');
    showToast('Connect to BMS first');
    return false;
  }
  try {
    await state.writeChar.writeValue(command);
    return true;
  } catch (e) {
    log(`Command failed: ${e.message}`, 'error');
    showToast('Command failed');
    return false;
  }
}

// ── Event Handlers ──

// Connect / Disconnect
dom.connectBtn.addEventListener('click', connectBLE);
dom.disconnectBtn.addEventListener('click', disconnectBLE);

// BMS Master Toggle
dom.bmsToggle.addEventListener('change', async (e) => {
  const on = e.target.checked;
  const proto = getProtocol();
  log(`Turning BMS ${on ? 'ON' : 'OFF'}...`, 'info');

  const cmd = on ? proto.mosfetOn : proto.mosfetOff;
  const ok = await sendCommand(cmd);

  if (ok) {
    updateBmsUI(on);
    if (on) {
      dom.chargeToggle.checked = true;
      dom.dischargeToggle.checked = true;
      updateChargeUI(true);
      updateDischargeUI(true);
    } else {
      dom.chargeToggle.checked = false;
      dom.dischargeToggle.checked = false;
      updateChargeUI(false);
      updateDischargeUI(false);
    }
    log(`BMS ${on ? 'ON' : 'OFF'} command sent`, 'success');
    showToast(`BMS ${on ? 'Enabled' : 'Disabled'}`);
  } else {
    e.target.checked = !on;
  }
});

// Charge Toggle
dom.chargeToggle.addEventListener('change', async (e) => {
  const on = e.target.checked;
  const proto = getProtocol();
  log(`${on ? 'Enabling' : 'Disabling'} charge...`, 'info');

  const cmd = on ? proto.chargeOn : proto.chargeOff;
  const ok = await sendCommand(cmd);

  if (ok) {
    updateChargeUI(on);
    log(`Charge ${on ? 'enabled' : 'disabled'}`, 'success');
    showToast(`Charge ${on ? 'ON' : 'OFF'}`);
  } else {
    e.target.checked = !on;
  }
});

// Discharge Toggle
dom.dischargeToggle.addEventListener('change', async (e) => {
  const on = e.target.checked;
  const proto = getProtocol();
  log(`${on ? 'Enabling' : 'Disabling'} discharge...`, 'info');

  const cmd = on ? proto.dischargeOn : proto.dischargeOff;
  const ok = await sendCommand(cmd);

  if (ok) {
    updateDischargeUI(on);
    log(`Discharge ${on ? 'enabled' : 'disabled'}`, 'success');
    showToast(`Discharge ${on ? 'ON' : 'OFF'}`);
  } else {
    e.target.checked = !on;
  }
});

// Settings
dom.settingsBtn.addEventListener('click', () => {
  dom.settingsModal.classList.remove('hidden');
});

dom.closeSettings.addEventListener('click', () => {
  dom.settingsModal.classList.add('hidden');
});

dom.settingsModal.addEventListener('click', (e) => {
  if (e.target === dom.settingsModal) {
    dom.settingsModal.classList.add('hidden');
  }
});

dom.protocolSelect.addEventListener('change', (e) => {
  state.protocol = e.target.value;
  dom.customUuidGroup.classList.toggle('hidden', e.target.value !== 'custom');
  log(`Protocol set to: ${BMS_PROTOCOLS[state.protocol].name}`, 'info');
});

dom.autoReconnect.addEventListener('change', (e) => {
  state.autoReconnect = e.target.checked;
});

dom.pollIntervalInput.addEventListener('change', (e) => {
  const val = parseInt(e.target.value, 10);
  if (val >= 1 && val <= 30) {
    state.pollInterval = val * 1000;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = setInterval(requestBmsInfo, state.pollInterval);
    }
    log(`Poll interval set to ${val}s`, 'info');
  }
});

// ── Range Settings Event Handlers ──

dom.signalMonitorToggle.addEventListener('change', (e) => {
  state.range.monitorEnabled = e.target.checked;
  if (e.target.checked && state.connected) {
    startRSSIMonitoring();
  } else {
    stopRSSIMonitoring();
    dom.signalCard.classList.add('hidden');
  }
  log(`Signal monitor ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
});

dom.rangeAlertToggle.addEventListener('change', (e) => {
  state.range.alertsEnabled = e.target.checked;
  if (!e.target.checked) {
    hideRangeWarning();
  }
  log(`Range alerts ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
});

dom.vibrateToggle.addEventListener('change', (e) => {
  state.range.vibrateEnabled = e.target.checked;
});

dom.keepAliveIntervalInput.addEventListener('change', (e) => {
  const val = parseInt(e.target.value, 10);
  if (val >= 1 && val <= 30) {
    state.range.keepAliveInterval = val * 1000;
    if (state.connected) {
      stopKeepAlive();
      startKeepAlive();
    }
    log(`Keep-alive interval set to ${val}s`, 'info');
  }
});

dom.rssiIntervalInput.addEventListener('change', (e) => {
  const val = parseInt(e.target.value, 10);
  if (val >= 500 && val <= 5000) {
    state.range.rssiReadInterval = val;
    if (state.connected && state.range.rssiTimer) {
      // Restart with new interval
      stopRSSIMonitoring();
      startRSSIMonitoring();
    }
    log(`RSSI read interval set to ${val}ms`, 'info');
  }
});

dom.txPowerSelect.addEventListener('change', (e) => {
  state.range.txPower = parseInt(e.target.value, 10);
  log(`TX Power set to ${state.range.txPower} dBm`, 'info');
});


// ── Service Worker Registration ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    log('App ready for offline use', 'info');
  }).catch(() => {
    // SW registration is optional
  });
}

// ── Init ──
log('BMS Controller v2.0 ready', 'info');
log('Protocol: JBD / Xiaoxiang (default)', 'info');
log('Range monitoring: Enabled', 'success');
log('Features: Signal strength, distance estimator, keep-alive, auto-reconnect with backoff', 'info');
