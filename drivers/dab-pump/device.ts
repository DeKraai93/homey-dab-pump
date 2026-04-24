import Homey = require('homey');
import { DABClient } from '../../lib/dab-client';
import { parseDABState } from '../../lib/dab-state';
import { detectPumpFeatures } from '../../lib/pump-features';
import { detectPumpModel } from '../../lib/pump-model';
import { buildPumpProfile } from '../../lib/pump-profile';

const DEBUG = false;

class MyDevice extends Homey.Device {
  private pollInterval?: NodeJS.Timeout;
  private client?: DABClient;
  private installationId = '';
  private serial = '';
  private hasLoggedRawDevice = false;
  private lastRawDevice: any = null;

  private lastRunning: boolean | null = null;
  private lastOnline: boolean | null = null;
  private lastAlarm: boolean | null = null;
  private lastPowerShowerActive: boolean | null = null;
  private lastSleepModeActive: boolean | null = null;
  private lastWaterFlowing: boolean | null = null;

  private consecutivePollFailures = 0;
  private readonly maxPollFailuresBeforeUnavailable = 3;

  private getUserFriendlyError(error: any): string {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('FORBIDDEN') || message.includes('Not allowed operation')) {
      return 'This function is not available for your DAB account.';
    }

    if (
      message.includes('ENOTFOUND') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('timeout')
    ) {
      return 'The pump is temporarily unreachable.';
    }

    if (message.toLowerCase().includes('device not found')) {
      return 'The pump could not be found.';
    }

    if (message.toLowerCase().includes('missing device credentials')) {
      return 'The pump is missing required connection data.';
    }

    if (message.toLowerCase().includes('not initialized')) {
      return 'The pump is not ready yet. Please try again.';
    }

    return 'The requested action could not be completed.';
  }

  async onInit(): Promise<void> {
    this.log('MyDevice has been initialized');

    await this.ensureCapabilities();

    const store = this.getStore();

    const username = store.username;
	const password = store.password;
	this.installationId = store.installationId || '';
	this.serial = store.serial || this.getData().id || '';

    if (!username || !password || !this.installationId || !this.serial) {
      this.error('Missing device store data', {
        hasUsername: Boolean(username),
        hasPassword: Boolean(password),
        installationId: this.installationId,
        serial: this.serial,
      });
      await this.setUnavailable('Missing device credentials or identifiers');
      return;
    }

    this.client = new DABClient(username, password);
	
    if (this.hasCapability('onoff')) {
      await this.setCapabilityValue('onoff', true);
    }

    if (this.hasCapability('alarm_generic')) {
      await this.setCapabilityValue('alarm_generic', false);
    }

        if (this.hasCapability('dab_powershower_active')) {
      await this.setCapabilityValue('dab_powershower_active', false).catch(() => null);
    }

    if (this.hasCapability('dab_sleepmode_enabled')) {
      await this.setCapabilityValue('dab_sleepmode_enabled', false).catch(() => null);
    }

    this.registerCapabilityListener('onoff', async (value: boolean) => {
      await this.setPumpEnabledFromUi(value);
    });

        if (this.hasCapability('dab_powershower_active')) {
      this.registerCapabilityListener('dab_powershower_active', async (value: boolean) => {
        await this.setPowerShowerEnabled(value);
      });
    }

    if (this.hasCapability('dab_sleepmode_enabled')) {
      this.registerCapabilityListener('dab_sleepmode_enabled', async (value: boolean) => {
        await this.setSleepModeEnabled(value);
      });
    }

    await this.updateState();

    this.pollInterval = setInterval(async () => {
      try {
        await this.updateState();
        this.consecutivePollFailures = 0;
      } catch (error) {
        this.consecutivePollFailures += 1;
        this.error('Polling failed', error);

        if (this.consecutivePollFailures >= this.maxPollFailuresBeforeUnavailable) {
          await this.setUnavailable(this.getUserFriendlyError(error));
        }
      }
    }, 10000);
  }

  async onAdded(): Promise<void> {
    this.log('MyDevice has been added');
  }

  async onDeleted(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.log('MyDevice has been deleted');
  }

  async refreshNow(): Promise<void> {
    await this.updateState();
  }

  isPumpRunning(): boolean {
    return this.lastRunning === true;
  }

  isPumpOnline(): boolean {
    return this.lastOnline === true;
  }

  hasPumpAlarm(): boolean {
    return this.lastAlarm === true;
  }

  isPowerShowerActive(): boolean {
    return this.lastPowerShowerActive === true;
  }

  isSleepModeActive(): boolean {
    return this.lastSleepModeActive === true;
  }

  isWaterFlowing(): boolean {
    return this.lastWaterFlowing === true;
  }

  async setPowerShowerFromFlow(enabled: boolean): Promise<void> {
  await this.setPowerShowerEnabled(enabled);
  }

  async setSleepModeFromFlow(enabled: boolean): Promise<void> {
    await this.setSleepModeEnabled(enabled);
  }

  async generateDiagnosticReport(): Promise<void> {
    await this.updateState();

    const features = detectPumpFeatures(this.lastRawDevice || {});
    const model = detectPumpModel(this.lastRawDevice || {});
    const profile = buildPumpProfile(model, features);
    const state = parseDABState(this.lastRawDevice || {});

    const generatedAt = new Date().toISOString();

    const raw = this.sanitizeDiagnosticObject(this.lastRawDevice || {});
    const rawStatus = raw?.status || {};

    const compactReport = {
      generatedAt,
      appId: this.homey.app.manifest.id,
      appVersion: this.homey.app.manifest.version,
      driverId: this.driver.id,
      deviceName: this.getName(),

      model,
      features,
      profile,

      state: {
        online: state.online,
        pressure: state.pressure,
        suctionPressure: state.suctionPressure,
        targetPressure: state.targetPressure,
        flow: state.flow,
        isOn: state.isOn,
        power: state.power,
        temperature: state.temperature,
        energyKwh: state.energyKwh,
        alarm: state.alarm,
        powerShowerActive: state.powerShowerActive,
        powerShowerPressure: state.powerShowerPressure,
        powerShowerCountdown: state.powerShowerCountdown,
        sleepModeEnabled: state.sleepModeEnabled,
        sleepModePressure: state.sleepModePressure,
        sleepModeCountdown: state.sleepModeCountdown,
      },

      rawSummary: {
        family: raw?.family || '',
        productName: raw?.ProductName || '',
        configurationName: raw?.configuration_name || '',
        statusSource: raw?._debugStatusSource || '',
        lastReceived: raw?.lastreceived || '',
        productType: rawStatus?.ProductType || '',
        pumpStatus: rawStatus?.PumpStatus || '',
        systemStatus: rawStatus?.SystemStatus || '',
        firmwareStatus: rawStatus?.FirmwareStatus || '',
      },

      supportedCapabilities: this.getCapabilities(),
    };

    const reportJson = JSON.stringify(compactReport);

    await this.triggerDeviceCard('diagnostic_report_created', {
      report_json: reportJson,
      model_key: model.modelKey || '',
      driver_key: profile.driverKey || '',
      display_name: profile.displayName || '',
      status_source: String(this.lastRawDevice?._debugStatusSource || ''),
      last_received: String(this.lastRawDevice?.lastreceived || ''),
      generated_at: generatedAt,
    });

    this.log('Diagnostic report generated');
  }

  private async setPumpEnabledFromUi(value: boolean): Promise<void> {
    if (!this.client) {
      throw new Error('DAB client not initialized');
    }

    if (DEBUG) {
      this.log(`onoff => ${value}`);
    }

    try {
      await this.client.setPumpEnabled(this.serial, value);

      setTimeout(async () => {
        try {
          await this.updateState();
        } catch (error) {
          this.error('Post-write refresh failed', error);
        }
      }, 2000);
    } catch (error: any) {
      this.error('Pump enable/disable failed', error);

      try {
        await this.updateState();
      } catch (refreshError) {
        this.error('State refresh after failed write also failed', refreshError);
      }

            throw new Error(this.getUserFriendlyError(error));
    }
  }

  private async setPowerShowerEnabled(value: boolean): Promise<void> {
    if (!this.client) {
    throw new Error('DAB client not initialized');
    }

	if (DEBUG) {
    this.log(`dab_powershower_active => ${value}`);
	}

	try {
    await this.client.setPowerShowerEnabled(this.serial, value);

    setTimeout(async () => {
      try {
        await this.updateState();
      } catch (error) {
        this.error('Post-write PowerShower refresh failed', error);
      }
    }, 2000);

    setTimeout(async () => {
      try {
        await this.updateState();
      } catch (error) {
        this.error('Delayed PowerShower refresh failed', error);
      }
    }, 8000);
	} catch (error: any) {
    this.error('PowerShower write failed', error);

    try {
      await this.updateState();
    } catch (refreshError) {
      this.error('State refresh after failed PowerShower write also failed', refreshError);
    }

    throw new Error(this.getUserFriendlyError(error));
	}
  }

  private async setSleepModeEnabled(value: boolean): Promise<void> {
    if (!this.client) {
      throw new Error('DAB client not initialized');
    }

    if (DEBUG) {
      this.log(`dab_sleepmode_enabled => ${value}`);
    }

    try {
      await this.client.setSleepModeEnabled(this.serial, value);

      setTimeout(async () => {
        try {
          await this.updateState();
        } catch (error) {
          this.error('Post-write SleepMode refresh failed', error);
        }
      }, 2000);

      setTimeout(async () => {
        try {
          await this.updateState();
        } catch (error) {
          this.error('Delayed SleepMode refresh failed', error);
        }
      }, 8000);
    } catch (error: any) {
      this.error('SleepMode write failed', error);

      try {
        await this.updateState();
      } catch (refreshError) {
        this.error('State refresh after failed SleepMode write also failed', refreshError);
      }

      throw new Error(this.getUserFriendlyError(error));
    }
  }

  private async ensureCapabilities(): Promise<void> {
    const baseCapabilities = [
      'measure_pressure',
      'dab_target_pressure',
      'measure_power',
      'measure_temperature',
      'meter_power',
      'onoff',
      'alarm_generic',
    ];

    for (const capability of baseCapabilities) {
      if (!this.hasCapability(capability)) {
        this.log(`Adding missing capability: ${capability}`);
        await this.addCapability(capability);
      }
    }
  }

  private async addCapabilityIfMissing(capability: string): Promise<void> {
    if (!this.hasCapability(capability)) {
      this.log(`Adding capability: ${capability}`);
      await this.addCapability(capability);
    }
  }

  private async removeCapabilityIfPresent(capability: string): Promise<void> {
    if (this.hasCapability(capability)) {
      this.log(`Removing capability: ${capability}`);
      await this.removeCapability(capability);
    }
  }

  private async syncDynamicCapabilities(features: {
    hasFlow: boolean;
    hasSuctionPressure: boolean;
    hasPowerShower: boolean;
    hasSleepMode: boolean;
  }): Promise<void> {
    if (features.hasFlow) {
      await this.addCapabilityIfMissing('dab_flow_l_min');
    } else {
      await this.removeCapabilityIfPresent('dab_flow_l_min');
    }

    if (features.hasSuctionPressure) {
      await this.addCapabilityIfMissing('dab_suction_pressure');
    } else {
      await this.removeCapabilityIfPresent('dab_suction_pressure');
    }

    if (features.hasPowerShower) {
      await this.addCapabilityIfMissing('dab_powershower_active');
      await this.addCapabilityIfMissing('dab_powershower_pressure');
      await this.addCapabilityIfMissing('dab_powershower_countdown');
    } else {
      await this.removeCapabilityIfPresent('dab_powershower_active');
      await this.removeCapabilityIfPresent('dab_powershower_pressure');
      await this.removeCapabilityIfPresent('dab_powershower_countdown');
    }

    if (features.hasSleepMode) {
      await this.addCapabilityIfMissing('dab_sleepmode_enabled');
      await this.addCapabilityIfMissing('dab_sleepmode_pressure');
      await this.addCapabilityIfMissing('dab_sleepmode_countdown');
    } else {
      await this.removeCapabilityIfPresent('dab_sleepmode_enabled');
      await this.removeCapabilityIfPresent('dab_sleepmode_pressure');
      await this.removeCapabilityIfPresent('dab_sleepmode_countdown');
    }
  }

  private maskValue(value: string, visibleChars = 6): string {
    if (!value) {
      return value;
    }

    if (value.length <= visibleChars) {
      return '*'.repeat(value.length);
    }

    return `${'*'.repeat(Math.max(0, value.length - visibleChars))}${value.slice(-visibleChars)}`;
  }

  private sanitizeDiagnosticObject(value: any): any {
    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeDiagnosticObject(item));
    }

    if (value && typeof value === 'object') {
      const result: Record<string, any> = {};

      for (const [key, raw] of Object.entries(value)) {
        const keyLc = key.toLowerCase();

        if (
          keyLc.includes('password') ||
          keyLc === 'username' ||
          keyLc.includes('token') ||
          keyLc === 'authorization' ||
          keyLc === 'cookie'
        ) {
          continue;
        }

        if (
          key === 'serial' ||
          key === 'ProductSerialNumber' ||
          key === 'dum_id' ||
          key === 'configuration_id'
        ) {
          result[key] = this.maskValue(String(raw));
          continue;
        }

        if (key === 'MacWlan') {
          result[key] = this.maskValue(String(raw), 5);
          continue;
        }

        if (key === 'IpExt') {
          result[key] = '<masked>';
          continue;
        }

        result[key] = this.sanitizeDiagnosticObject(raw);
      }

      return result;
    }

    return value;
  }

  private async triggerDeviceCard(
    id: string,
    tokens: Record<string, any> = {},
  ): Promise<void> {
    const card = this.homey.flow.getDeviceTriggerCard(id);
    await card.trigger(this, tokens, {});
  }

  private async updateState(): Promise<void> {
    if (!this.client) {
      throw new Error('DAB client not initialized');
    }

    if (DEBUG) {
      this.log('Fetching device state');
    }

    const device = await this.client.getDeviceState(this.installationId, this.serial);

    if (!device) {
      throw new Error('Device not found');
    }

    this.lastRawDevice = device;
    this.consecutivePollFailures = 0;

    const features = detectPumpFeatures(device);
    const model = detectPumpModel(device);
    const profile = buildPumpProfile(model, features);

    await this.syncDynamicCapabilities(features);

    if (!this.hasLoggedRawDevice) {
      this.hasLoggedRawDevice = true;

      if (DEBUG) {
        this.log(`Raw device payload: ${JSON.stringify(this.sanitizeDiagnosticObject(device))}`);
        this.log(`Status source: ${device?._debugStatusSource || 'unknown'}`);
        this.log(`Detected features: ${JSON.stringify(features)}`);
        this.log(`Detected model: ${JSON.stringify(model)}`);
        this.log(`Detected profile: ${JSON.stringify(profile)}`);

        if (device?._debugStatusPayload) {
          this.log(
            `Status payload sample: ${JSON.stringify(this.sanitizeDiagnosticObject(device._debugStatusPayload))}`,
          );
        }
      }

      await this.setStoreValue('pumpModelKey', model.modelKey);
      await this.setStoreValue('pumpFamily', model.family);
      await this.setStoreValue('pumpProductName', model.productName);
      await this.setStoreValue('pumpConfigurationName', model.configurationName);

      await this.setStoreValue('pumpDriverKey', profile.driverKey);
      await this.setStoreValue('pumpDisplayName', profile.displayName);
      await this.setStoreValue('supportsFlow', profile.supportsFlow);
      await this.setStoreValue('supportsSuctionPressure', profile.supportsSuctionPressure);
      await this.setStoreValue('supportsPowerShower', profile.supportsPowerShower);
      await this.setStoreValue('supportsSleepMode', profile.supportsSleepMode);
    }

    const state = parseDABState(device);

    const online = state.online;
    const isOn = state.isOn;
    const power = state.power;
    const alarm = state.alarm;
    const powerShowerActive = state.powerShowerActive;
    const sleepModeEnabled = state.sleepModeEnabled;
    const flow = state.flow;
    const pressure = state.pressure;

    const isRunning = power !== null ? power > 0 : (isOn ?? false);
    const isWaterFlowing = flow !== null ? flow > 0 : false;

    await this.setAvailable();

    if (!online && DEBUG) {
      this.log('DAB reports online=false, but state polling is still working');
    }

    if (pressure !== null && this.hasCapability('measure_pressure')) {
      await this.setCapabilityValue('measure_pressure', pressure);
      if (DEBUG) this.log(`pressure => ${pressure}`);
    }

    const suctionPressure = state.suctionPressure;
    if (suctionPressure !== null && this.hasCapability('dab_suction_pressure')) {
      await this.setCapabilityValue('dab_suction_pressure', suctionPressure);
      if (DEBUG) this.log(`suction pressure => ${suctionPressure}`);
    }

    const targetPressure = state.targetPressure;
    if (targetPressure !== null && this.hasCapability('dab_target_pressure')) {
      await this.setCapabilityValue('dab_target_pressure', targetPressure);
      if (DEBUG) this.log(`target pressure => ${targetPressure}`);
    }

    if (flow !== null && this.hasCapability('dab_flow_l_min')) {
      await this.setCapabilityValue('dab_flow_l_min', flow);
      if (DEBUG) this.log(`flow => ${flow}`);
    }

    if (isOn !== null && this.hasCapability('onoff')) {
      await this.setCapabilityValue('onoff', isOn);
      if (DEBUG) this.log(`onoff(state) => ${isOn}`);
    }

    if (power !== null && this.hasCapability('measure_power')) {
      await this.setCapabilityValue('measure_power', power);
      if (DEBUG) this.log(`power => ${power}`);
    }

    const temperature = state.temperature;
    if (temperature !== null && this.hasCapability('measure_temperature')) {
      await this.setCapabilityValue('measure_temperature', temperature);
      if (DEBUG) this.log(`temperature => ${temperature}`);
    }

    const energyKwh = state.energyKwh;
    if (energyKwh !== null && this.hasCapability('meter_power')) {
      await this.setCapabilityValue('meter_power', energyKwh);
      if (DEBUG) this.log(`energy => ${energyKwh}`);
    }

    if (this.hasCapability('alarm_generic')) {
      await this.setCapabilityValue('alarm_generic', alarm);
      if (DEBUG) this.log(`alarm => ${alarm}`);
    }

    if (powerShowerActive !== null && this.hasCapability('dab_powershower_active')) {
      await this.setCapabilityValue('dab_powershower_active', powerShowerActive);
      if (DEBUG) this.log(`powershower active => ${powerShowerActive}`);
    }

    const powerShowerPressure = state.powerShowerPressure;
    if (powerShowerPressure !== null && this.hasCapability('dab_powershower_pressure')) {
      await this.setCapabilityValue('dab_powershower_pressure', powerShowerPressure);
      if (DEBUG) this.log(`powershower pressure => ${powerShowerPressure}`);
    }

    const powerShowerCountdown = state.powerShowerCountdown;
    if (powerShowerCountdown !== null && this.hasCapability('dab_powershower_countdown')) {
      await this.setCapabilityValue('dab_powershower_countdown', powerShowerCountdown);
      if (DEBUG) this.log(`powershower countdown => ${powerShowerCountdown}`);
    }

    if (sleepModeEnabled !== null && this.hasCapability('dab_sleepmode_enabled')) {
      await this.setCapabilityValue('dab_sleepmode_enabled', sleepModeEnabled);
      if (DEBUG) this.log(`sleepmode enabled => ${sleepModeEnabled}`);
    }

    const sleepModePressure = state.sleepModePressure;
    if (sleepModePressure !== null && this.hasCapability('dab_sleepmode_pressure')) {
      await this.setCapabilityValue('dab_sleepmode_pressure', sleepModePressure);
      if (DEBUG) this.log(`sleepmode pressure => ${sleepModePressure}`);
    }

    const sleepModeCountdown = state.sleepModeCountdown;
    if (sleepModeCountdown !== null && this.hasCapability('dab_sleepmode_countdown')) {
      await this.setCapabilityValue('dab_sleepmode_countdown', sleepModeCountdown);
      if (DEBUG) this.log(`sleepmode countdown => ${sleepModeCountdown}`);
    }

    if (this.lastOnline !== null && this.lastOnline !== online) {
      await this.triggerDeviceCard(online ? 'pump_came_online' : 'pump_went_offline');
    }

    if (this.lastRunning !== null && this.lastRunning !== isRunning) {
      await this.triggerDeviceCard(
        isRunning ? 'pump_started' : 'pump_stopped',
        {
          pressure,
          flow,
          power,
        },
      );
    }

    if (this.lastAlarm !== null && this.lastAlarm !== alarm) {
      await this.triggerDeviceCard(alarm ? 'pump_alarm_turned_on' : 'pump_alarm_cleared');
    }

    if (this.lastPowerShowerActive !== null && this.lastPowerShowerActive !== powerShowerActive) {
      await this.triggerDeviceCard(
        powerShowerActive ? 'powershower_turned_on' : 'powershower_turned_off',
        {
          pressure,
        },
      );
    }

    if (this.lastSleepModeActive !== null && this.lastSleepModeActive !== sleepModeEnabled) {
      await this.triggerDeviceCard(
        sleepModeEnabled ? 'sleepmode_turned_on' : 'sleepmode_turned_off',
        {
          target_pressure: targetPressure,
        },
      );
    }

    if (this.lastWaterFlowing !== null && this.lastWaterFlowing !== isWaterFlowing) {
      await this.triggerDeviceCard(
        isWaterFlowing ? 'water_flow_started' : 'water_flow_stopped',
        {
          flow,
          pressure,
          power,
        },
      );
    }

    this.lastOnline = online;
    this.lastRunning = isRunning;
    this.lastAlarm = alarm;
    this.lastPowerShowerActive = powerShowerActive;
    this.lastSleepModeActive = sleepModeEnabled;
    this.lastWaterFlowing = isWaterFlowing;
  }
}

export = MyDevice;