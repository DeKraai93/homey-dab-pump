import Homey = require('homey');
const DEBUG = false;

class MyApp extends Homey.App {
  async onInit(): Promise<void> {
    if (DEBUG) this.log('DAB Pump app has been initialized');
  }
}

export = MyApp;