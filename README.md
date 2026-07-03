# BMS Controller

A Progressive Web App (PWA) to control your lithium battery BMS system via Bluetooth Low Energy (BLE).

## Features

- 🔋 **Battery Display** — Live voltage, current, temperature, SOC%, cell count
- ⚡ **BMS Master Toggle** — Turn entire BMS on/off (MOSFET control)
- 🔌 **Charge / Discharge** — Independent charge and discharge MOSFET toggles
- 📡 **Bluetooth BLE** — Connects via Web Bluetooth API (Chrome on Android)
- 🔄 **Auto-Reconnect** — Automatically reconnects if the BMS drops connection
- 📋 **Activity Log** — Live log of all commands and responses
- ⚙️ **Protocol Support** — JBD/Xiaoxiang, Daly, ANT BMS, or custom UUIDs

## Supported BMS Protocols

| Protocol | Common Brands |
|----------|---------------|
| **JBD / Xiaoxiang** | JBD, Xiaoxiang, Overkill Solar, many generic BMS |
| **Daly** | Daly Smart BMS |
| **ANT** | ANT BMS |
| **Custom** | Enter your own service/characteristic UUIDs |

## How to Use

1. Open the app in **Chrome on Android**: [https://aayush33-cell.github.io/bms-controller/](https://aayush33-cell.github.io/bms-controller/)
2. Tap **"Connect BMS"** — Chrome will show a Bluetooth device picker
3. Select your BMS device
4. Use the toggles to control charge/discharge MOSFETs

## Install as App

1. Open the link above in Chrome on Android
2. Tap the menu (⋮) → **"Add to Home Screen"**
3. The app installs like a native app with its own icon

## Requirements

- Android device with Bluetooth
- Chrome browser (Web Bluetooth API)
- A compatible BLE BMS module

## License

MIT
