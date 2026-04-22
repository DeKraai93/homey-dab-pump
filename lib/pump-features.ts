export type PumpFeatures = {
  hasFlow: boolean;
  hasSuctionPressure: boolean;
  hasPowerShower: boolean;
  hasSleepMode: boolean;
};

export function detectPumpFeatures(device: any): PumpFeatures {
  const status = device?.status || {};

  return {
    hasFlow: status?.VF_FlowLiter !== undefined,
    hasSuctionPressure: status?.PKm_SuctionPressureBar !== undefined,
    hasPowerShower:
      status?.PowerShowerPressureBar !== undefined ||
      status?.PowerShowerCommand !== undefined,
    hasSleepMode:
      status?.SleepModeEnable !== undefined ||
      status?.SleepModePressureBar !== undefined,
  };
}