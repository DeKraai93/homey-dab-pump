export type PumpModelInfo = {
  family: string;
  productName: string;
  configurationName: string;
  modelKey: string;
};

function normalize(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

export function detectPumpModel(device: any): PumpModelInfo {
  const family = normalize(device?.family);
  const productName = normalize(device?.ProductName);
  const configurationName = normalize(device?.configuration_name);

  let modelKey = 'generic';

  if (family.toLowerCase() === 'esyboxv2') {
    modelKey = 'esybox_v2';
  } else if (productName.toLowerCase().includes('esybox')) {
    modelKey = 'esybox';
  } else if (productName) {
    modelKey = productName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  return {
    family,
    productName,
    configurationName,
    modelKey,
  };
}