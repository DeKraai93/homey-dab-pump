import Homey = require('homey');
import { DABClient, DABDevice } from '../../lib/dab-client';
import { detectPumpFeatures } from '../../lib/pump-features';
import { detectPumpModel } from '../../lib/pump-model';
import { buildPumpProfile } from '../../lib/pump-profile';
import MyDevice = require('./device');

class MyDriver extends Homey.Driver {
  private static flowCardsRegistered = false;

  private pairUsername = '';
  private pairPassword = '';
  private pairDevices: DABDevice[] = [];

  private getUserFriendlyError(error: any): string {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes('401') ||
      message.toLowerCase().includes('invalid_grant') ||
      message.toLowerCase().includes('unable to authenticate')
    ) {
      return 'Login failed. Check your username and password.';
    }

    if (
      message.includes('ENOTFOUND') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('timeout')
    ) {
      return 'Unable to connect to DAB. Please try again later.';
    }

    if (message.toLowerCase().includes('no dab installations found')) {
      return 'No DAB installations were found for this account.';
    }

    if (message.toLowerCase().includes('no dab devices found')) {
      return 'No supported DAB devices were found for this account.';
    }

    if (message.toLowerCase().includes('missing username or password')) {
      return 'Please enter both username and password.';
    }

    return 'Unable to connect to DAB. Please try again.';
  }

  async onInit(): Promise<void> {
    this.log('MyDriver has been initialized');

    if (MyDriver.flowCardsRegistered) {
      return;
    }

    MyDriver.flowCardsRegistered = true;

    const pumpIsRunningCard = this.homey.flow.getConditionCard('pump_is_running');
    pumpIsRunningCard.registerRunListener(async (args: { device: MyDevice }) => {
      return args.device.isPumpRunning();
    });

    const pumpIsOnlineCard = this.homey.flow.getConditionCard('pump_is_online');
    pumpIsOnlineCard.registerRunListener(async (args: { device: MyDevice }) => {
      return args.device.isPumpOnline();
    });

    const pumpHasAlarmCard = this.homey.flow.getConditionCard('pump_has_alarm');
    pumpHasAlarmCard.registerRunListener(async (args: { device: MyDevice }) => {
      return args.device.hasPumpAlarm();
    });

    const powerShowerIsActiveCard = this.homey.flow.getConditionCard('powershower_is_active');
    powerShowerIsActiveCard.registerRunListener(async (args: { device: MyDevice }) => {
      return args.device.isPowerShowerActive();
    });

    const sleepModeIsActiveCard = this.homey.flow.getConditionCard('sleepmode_is_active');
    sleepModeIsActiveCard.registerRunListener(async (args: { device: MyDevice }) => {
      return args.device.isSleepModeActive();
    });

    const waterIsFlowingCard = this.homey.flow.getConditionCard('water_is_flowing');
    waterIsFlowingCard.registerRunListener(async (args: { device: MyDevice }) => {
      return args.device.isWaterFlowing();
    });

    const refreshPumpStateCard = this.homey.flow.getActionCard('refresh_pump_state');
    refreshPumpStateCard.registerRunListener(async (args: { device: MyDevice }) => {
      await args.device.refreshNow();
    });

    const setPowerShowerCard = this.homey.flow.getActionCard('set_powershower');
    setPowerShowerCard.registerRunListener(
      async (args: { device: MyDevice; state: string }) => {
        await args.device.setPowerShowerFromFlow(args.state === 'on');
      },
    );

    const setSleepModeCard = this.homey.flow.getActionCard('set_sleepmode');
    setSleepModeCard.registerRunListener(
      async (args: { device: MyDevice; state: string }) => {
        await args.device.setSleepModeFromFlow(args.state === 'on');
      },
    );

    const generateDiagnosticReportCard =
      this.homey.flow.getActionCard('generate_diagnostic_report');
    generateDiagnosticReportCard.registerRunListener(async (args: { device: MyDevice }) => {
      await args.device.generateDiagnosticReport();
    });
  }

  async onPair(session: any): Promise<void> {
    this.log('Pair session started');

    session.setHandler('login', async (data: { username?: string; password?: string }) => {
      this.pairUsername = (data.username || '').trim();
      this.pairPassword = data.password || '';
      this.pairDevices = [];

      this.log(`login handler called for ${this.pairUsername || '<empty>'}`);

      if (!this.pairUsername || !this.pairPassword) {
        throw new Error('Please enter both username and password');
      }

      try {
        const client = new DABClient(this.pairUsername, this.pairPassword);
        const devices = await client.listDevices();

        for (const pairDevice of devices) {
          try {
            const rawDevice = await client.getDeviceState(
              pairDevice.installationId,
              pairDevice.serial || pairDevice.id,
            );

            const features = detectPumpFeatures(rawDevice);
            const model = detectPumpModel(rawDevice);
            const profile = buildPumpProfile(model, features);

            this.log(
              `Pairing profile for ${pairDevice.name}: ${JSON.stringify(profile)}`,
            );

            (pairDevice as any).profile = profile;
            (pairDevice as any).model = model;
            (pairDevice as any).features = features;
          } catch (profileError) {
            this.error(
              `Failed to build pairing profile for ${pairDevice.name}`,
              profileError,
            );
          }
        }

        this.pairDevices = devices;

        this.log(`Login verified; found ${devices.length} device(s)`);
        return true;
      } catch (error: any) {
        this.error('Login/discovery failed', error);
        throw new Error(this.getUserFriendlyError(error));
      }
    });

    session.setHandler('list_devices', async () => {
      this.log(
        `list_devices called (username=${this.pairUsername || '<empty>'}, cachedDevices=${this.pairDevices.length})`,
      );

      if (!this.pairUsername || !this.pairPassword) {
        throw new Error('No credentials received. Go back and log in again.');
      }

      if (!this.pairDevices.length) {
        throw new Error('No devices found. Go back and log in again.');
      }

      return this.pairDevices.map(device => ({
        name: device.name,
        data: {
          id: device.id,
        },
        store: {
          username: this.pairUsername,
          password: this.pairPassword,
          installationId: device.installationId,
          serial: device.serial || '',
          product: device.product || '',
          configurationId: device.configurationId || '',

          pumpModelKey: (device as any).profile?.modelKey || '',
          pumpDriverKey: (device as any).profile?.driverKey || '',
          pumpDisplayName: (device as any).profile?.displayName || '',

          pumpFamily: (device as any).model?.family || '',
          pumpProductName: (device as any).model?.productName || '',
          pumpConfigurationName: (device as any).model?.configurationName || '',

          supportsFlow: (device as any).features?.hasFlow ?? false,
          supportsSuctionPressure:
            (device as any).features?.hasSuctionPressure ?? false,
          supportsPowerShower:
            (device as any).features?.hasPowerShower ?? false,
          supportsSleepMode:
            (device as any).features?.hasSleepMode ?? false,
        },
      }));
    });
  }
}

export = MyDriver;