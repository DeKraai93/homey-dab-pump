import { PumpFeatures } from './pump-features';
import { PumpModelInfo } from './pump-model';

export type PumpProfile = {
  modelKey: string;
  driverKey: string;
  displayName: string;
  supportsFlow: boolean;
  supportsSuctionPressure: boolean;
  supportsPowerShower: boolean;
  supportsSleepMode: boolean;
};

export function buildPumpProfile(
  model: PumpModelInfo,
  features: PumpFeatures,
): PumpProfile {
  let driverKey = 'dab-pump';
  let displayName = model.productName || 'DAB Pump';

  if (model.modelKey === 'esybox_v2') {
  driverKey = 'esybox';
  displayName = 'Esybox';
}

/**
 * FUTURE H2D DEVICES (scaffold only - not active yet)
 *
 * Uncomment when validated with real devices/logs
 */

// else if (model.modelKey === 'esybox_mini_3') {
//   driverKey = 'esybox-mini-3';
//   displayName = 'Esybox Mini 3';
// }

// else if (model.modelKey === 'esybox_max') {
//   driverKey = 'esybox-max';
//   displayName = 'Esybox Max';
// }

// else if (model.modelKey === 'ngpanel') {
//   driverKey = 'ngpanel';
//   displayName = 'NGPanel';
// }

// else if (model.modelKey === 'ngdrive') {
//   driverKey = 'ngdrive';
//   displayName = 'NGDrive';
// }

// else if (model.modelKey === 'esybox_mini') {
//   driverKey = 'esybox-mini';
//   displayName = 'Esybox Mini';
// }

// else if (model.modelKey === 'esybox_diver') {
//   driverKey = 'esybox-diver';
//   displayName = 'Esybox Diver';
// }

else if (model.productName) {
  displayName = model.productName;
}

  return {
    modelKey: model.modelKey,
    driverKey,
    displayName,
    supportsFlow: features.hasFlow,
    supportsSuctionPressure: features.hasSuctionPressure,
    supportsPowerShower: features.hasPowerShower,
    supportsSleepMode: features.hasSleepMode,
  };
}