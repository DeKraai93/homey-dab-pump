type DABRawDevice = any;

function parseTenths(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === 'h') {
    return null;
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return null;
  }

  return numeric / 10;
}

function parseNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '' || value === 'h') {
    return null;
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return null;
  }

  return numeric;
}

function firstNumber(...values: Array<number | null>): number | null {
  for (const value of values) {
    if (value !== null) {
      return value;
    }
  }

  return null;
}

export type ParsedDABState = {
  pressure: number | null;
  suctionPressure: number | null;
  targetPressure: number | null;
  flow: number | null;
  isOn: boolean | null;
  power: number | null;
  temperature: number | null;
  energyKwh: number | null;
  alarm: boolean;
  powerShowerActive: boolean | null;
  powerShowerPressure: number | null;
  powerShowerCountdown: number | null;
  sleepModeEnabled: boolean | null;
  sleepModePressure: number | null;
  sleepModeCountdown: number | null;
  online: boolean;
};

export function parseDABState(device: DABRawDevice): ParsedDABState {
  const status = device?.status || {};

  const pressure = firstNumber(
    parseTenths(status?.VP_PressureBar),
    parseNumber(status?.pressure),
    parseNumber(status?.pressure_bar),
    parseNumber(status?.actual_pressure),
    parseNumber(status?.pOut),
    parseNumber(status?.p_out),
    parseNumber(device?.pressure),
    parseNumber(device?.measure_pressure),
    parseNumber(device?.pressure_bar),
    parseNumber(device?.actual_pressure),
    parseNumber(device?.pOut),
    parseNumber(device?.p_out),
    parseNumber(device?.configuration?.pressure),
  );

  const suctionPressure = firstNumber(
    parseTenths(status?.PKm_SuctionPressureBar),
    parseNumber(status?.suction_pressure),
    parseNumber(device?.suction_pressure),
  );

  const targetPressure = firstNumber(
    parseTenths(status?.SP_SetpointPressureBar),
    parseTenths(status?.SleepModePressureBar),
    parseTenths(status?.PowerShowerPressureBar),
    parseNumber(status?.target_pressure),
    parseNumber(device?.target_pressure),
  );

  const flow = firstNumber(
    parseNumber(status?.VF_FlowLiter),
    parseNumber(status?.flow),
    parseNumber(device?.flow),
  );

  let isOn: boolean | null = null;
  if (status?.PumpDisable !== undefined && status?.PumpDisable !== null) {
    isOn = String(status.PumpDisable) !== '1';
  } else {
    const candidates = [
      device?.status?.on,
      device?.status?.enabled,
      device?.status?.pump_enabled,
      device?.on,
      device?.enabled,
      device?.pump_enabled,
    ];

    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null) {
        isOn = Boolean(candidate);
        break;
      }
    }
  }

  const power = firstNumber(
    parseNumber(status?.PO_OutputPower),
    parseNumber(status?.power),
    parseNumber(device?.power),
  );

  const temperature = firstNumber(
    parseTenths(status?.TE_HeatsinkTemperatureC),
    parseNumber(status?.temperature),
    parseNumber(device?.temperature),
  );

  const energyKwh = firstNumber(
    parseTenths(status?.TotalEnergy),
    parseNumber(device?.totalEnergy),
  );

  const totalErrors = parseNumber(device?.total_errors);
  const latestError = parseNumber(status?.LatestError);
  const errorList = String(device?.error_list || '');

  const alarm =
    (totalErrors !== null && totalErrors > 0) ||
    (latestError !== null && latestError > 0) ||
    (errorList !== '' && errorList !== '0');

  const powerShowerCountdown = parseNumber(status?.PowerShowerCountdown);

  let powerShowerActive: boolean | null = null;
  if (powerShowerCountdown !== null) {
    powerShowerActive = powerShowerCountdown > 0;
  } else if (status?.PowerShowerCommand !== undefined && status?.PowerShowerCommand !== null) {
    powerShowerActive = String(status.PowerShowerCommand) === '1';
  }

  const powerShowerPressure = parseTenths(status?.PowerShowerPressureBar);

  let sleepModeEnabled: boolean | null = null;
  if (status?.SleepModeEnable !== undefined && status?.SleepModeEnable !== null) {
    sleepModeEnabled = String(status.SleepModeEnable) === '1';
  }

  const sleepModePressure = parseTenths(status?.SleepModePressureBar);
  const sleepModeCountdown = parseNumber(status?.SleepModeCountdown);

  return {
    pressure,
    suctionPressure,
    targetPressure,
    flow,
    isOn,
    power,
    temperature,
    energyKwh,
    alarm,
    powerShowerActive,
    powerShowerPressure,
    powerShowerCountdown,
    sleepModeEnabled,
    sleepModePressure,
    sleepModeCountdown,
    online: device?.online !== false,
  };
}