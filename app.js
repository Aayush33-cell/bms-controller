/* ============================================
   BMS Controller — Application Logic
   Handles BLE communication with BMS hardware
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
    updateConnectionUI(true);
    log('Connected successfully!', 'success');
    showToast('BMS Connected ✓');

    // Start polling
    requestBmsInfo();
    state.pollTimer = setInterval(requestBmsInfo, state.pollInterval);

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
  updateConnectionUI(false);
  log('Device disconnected', 'warn');
  showToast('BMS Disconnected');

  if (state.autoReconnect) {
    log('Auto-reconnect in 3s...', 'info');
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
          updateConnectionUI(true);
          log('Reconnected!', 'success');
          showToast('Reconnected ✓');

          requestBmsInfo();
          state.pollTimer = setInterval(requestBmsInfo, state.pollInterval);
        } catch (e) {
          log(`Reconnect failed: ${e.message}`, 'error');
        }
      }
    }, 3000);
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

// ── Service Worker Registration ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    log('App ready for offline use', 'info');
  }).catch(() => {
    // SW registration is optional
  });
}

// ── Init ──
log('BMS Controller v1.0 ready', 'info');
log('Protocol: JBD / Xiaoxiang (default)', 'info');
