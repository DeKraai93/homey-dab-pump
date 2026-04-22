import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

export type DABDevice = {
  id: string;
  name: string;
  installationId: string;
  serial?: string;
  product?: string;
  configurationId?: string;
};

type FetchMethod = 'dabcs' | 'dconnect';

type InstallationSummary = {
  installation_id?: string;
  id?: string | number;
  name?: string;
  description?: string;
};

const DABSSO_API_URL = 'https://dabsso.dabpumps.com';
const DABCS_API_URL = 'https://api.eu.dabcs.it';
const DCONNECT_API_URL = 'https://dconnect.dabpumps.com';

const H2D_APP_REDIRECT_URI = 'dabiopapp://Welcome';
const H2D_APP_CLIENT_ID = 'h2d-mobile';

const DCONNECT_APP_CLIENT_ID = 'DWT-Dconnect-Mobile';
const DCONNECT_APP_CLIENT_SECRET = 'ce2713d8-4974-4e0c-a92e-8b942dffd561';
const DCONNECT_APP_USER_AGENT =
  'Dalvik/2.1.0 (Linux; U; Android 9; SM-G935F Build/PI) DConnect/2.13.1';

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildFormBody(
  data: Record<string, string | number | boolean | undefined>,
): URLSearchParams {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  }

  return body;
}

function parseHtmlFormAction(html: string): string {
  const match = html.match(/action\s*=\s*"([^"]+)"/i);
  if (!match?.[1]) {
    throw new Error('Unable to find login form action');
  }

  return match[1].replace(/&amp;/g, '&');
}

function normalizeDeviceName(
  installName: string,
  dum: Record<string, any>,
  index: number,
): string {
  const deviceName =
    dum.name ||
    dum.ProductName ||
    dum.distro_embedded ||
    dum.serial ||
    `device ${index + 1}`;

  if (!installName) {
    return String(deviceName);
  }

  return `${installName} - ${deviceName}`;
}

export class DABClient {
  private readonly username: string;
  private readonly password: string;
  private readonly api: AxiosInstance;

  private accessToken: string | null = null;
  private fetchMethod: FetchMethod | null = null;
  private extraHeaders: Record<string, string> = {};

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;

    this.api = axios.create({
      timeout: 20000,
      withCredentials: true,
      validateStatus: () => true,
      headers: {
        'Cache-Control': 'no-store, no-cache, max-age=0',
        Connection: 'close',
        'User-Agent': 'Homey DAB Pump',
      },
    });
  }

  private getAuthHeaders(
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.extraHeaders,
      ...extraHeaders,
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  private async loginH2DApp(): Promise<boolean> {
    const state = toBase64Url(crypto.randomBytes(16));
    const codeVerifier = toBase64Url(crypto.randomBytes(86));
    const codeChallenge = toBase64Url(
      crypto.createHash('sha256').update(codeVerifier, 'utf8').digest(),
    );

    const authResponse = await this.api.get(
      `${DABSSO_API_URL}/auth/realms/dwt-group/protocol/openid-connect/auth`,
      {
        params: {
          client_id: H2D_APP_CLIENT_ID,
          response_type: 'code',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          scope: 'openid profile email phone',
          redirect_uri: H2D_APP_REDIRECT_URI,
        },
        responseType: 'text',
      },
    );

    if (
      authResponse.status < 200 ||
      authResponse.status >= 400 ||
      typeof authResponse.data !== 'string'
    ) {
      return false;
    }

    const actionUrl = parseHtmlFormAction(authResponse.data);

    const loginResponse = await this.api.post(
      actionUrl,
      buildFormBody({
        username: this.username,
        password: this.password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        maxRedirects: 0,
        responseType: 'text',
      },
    );

    const location = String(loginResponse.headers.location || '');
    if (!location.startsWith(H2D_APP_REDIRECT_URI)) {
      return false;
    }

    const locationUrl = new URL(location);
    const returnedState = locationUrl.searchParams.get('state');
    const code = locationUrl.searchParams.get('code');

    if (!code || returnedState !== state) {
      return false;
    }

    const tokenResponse = await this.api.post(
      `${DABSSO_API_URL}/auth/realms/dwt-group/protocol/openid-connect/token`,
      buildFormBody({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        client_id: H2D_APP_CLIENT_ID,
        redirect_uri: H2D_APP_REDIRECT_URI,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      return false;
    }

    this.accessToken = String(accessToken);
    this.fetchMethod = 'dabcs';
    this.extraHeaders = {};
    return true;
  }

  private async loginDabLive(isDabLive: 0 | 1): Promise<boolean> {
    const response = await this.api.post(
      `${DCONNECT_API_URL}/auth/token`,
      buildFormBody({
        username: this.username,
        password: this.password,
      }).toString(),
      {
        params: {
          isDabLive,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      return false;
    }

    this.accessToken = String(accessToken);
    this.fetchMethod = 'dconnect';
    this.extraHeaders = {};
    return true;
  }

  private async loginDConnectApp(): Promise<boolean> {
    const response = await this.api.post(
      `${DABSSO_API_URL}/auth/realms/dwt-group/protocol/openid-connect/token`,
      buildFormBody({
        client_id: DCONNECT_APP_CLIENT_ID,
        client_secret: DCONNECT_APP_CLIENT_SECRET,
        scope: 'openid',
        grant_type: 'password',
        username: this.username,
        password: this.password,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const accessToken = response.data?.access_token;
    if (!accessToken) {
      return false;
    }

    this.accessToken = String(accessToken);
    this.fetchMethod = 'dconnect';
    this.extraHeaders = {
      'User-Agent': DCONNECT_APP_USER_AGENT,
    };
    return true;
  }

  async login(): Promise<void> {
    if (!this.username || !this.password) {
      throw new Error('Missing username or password');
    }

    if (this.accessToken && this.fetchMethod) {
      return;
    }

    this.accessToken = null;
    this.fetchMethod = null;
    this.extraHeaders = {};

    const attempts: Array<{ name: string; fn: () => Promise<boolean> }> = [
      { name: 'H2D app login', fn: () => this.loginH2DApp() },
      { name: 'DAB Live login', fn: () => this.loginDabLive(1) },
      { name: 'DConnect login', fn: () => this.loginDabLive(0) },
      { name: 'DConnect app login', fn: () => this.loginDConnectApp() },
    ];

    const errors: string[] = [];

    for (const attempt of attempts) {
      try {
        const success = await attempt.fn();
        if (success) {
          return;
        }
        errors.push(`${attempt.name}: rejected`);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${attempt.name}: ${message}`);
      }
    }

    throw new Error(`Unable to authenticate with DAB. ${errors.join(' | ')}`);
  }

  async getInstallations(): Promise<InstallationSummary[]> {
    await this.login();

    if (this.fetchMethod === 'dabcs') {
      const response = await this.api.get(`${DABCS_API_URL}/mobile/v1/installations`, {
        headers: this.getAuthHeaders(),
      });

      return response.data?.installations || [];
    }

    const response = await this.api.get(`${DCONNECT_API_URL}/api/v1/installation`, {
      headers: this.getAuthHeaders(),
    });

    return response.data?.values || response.data?.rows || [];
  }

  async getInstallationDevices(installationId: string): Promise<any[]> {
    await this.login();

    if (this.fetchMethod === 'dabcs') {
      const response = await this.api.get(
        `${DABCS_API_URL}/mobile/v1/installations/${installationId}/dums`,
        {
          params: {
            include_configuration: true,
          },
          headers: this.getAuthHeaders(),
        },
      );

      return response.data?.dums || [];
    }

    const response = await this.api.get(
      `${DCONNECT_API_URL}/api/v1/installation/${installationId}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    return response.data?.dums || [];
  }

  private async getDabcsDeviceState(installationId: string, serial: string): Promise<any> {
    const response = await this.api.get(
      `${DABCS_API_URL}/mobile/v1/installations/${installationId}/dums`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    const raw = response.data;
    const dums = Array.isArray(raw) ? raw : raw?.dums || [];

    return dums.find((d: any) => String(d.serial) === String(serial)) || null;
  }

  private async getDconnectDeviceState(
    installationId: string,
    serial: string,
    inventory: any | null,
  ): Promise<any> {
    const candidates = [
      `${DCONNECT_API_URL}/dumstate/${serial}`,
      `${DCONNECT_API_URL}/api/v1/dum/${serial}/state`,
      `${DCONNECT_API_URL}/api/v1/device/${serial}`,
      `${DCONNECT_API_URL}/api/v1/dum/${serial}`,
      `${DCONNECT_API_URL}/api/v1/installation/${installationId}/device/${serial}`,
      `${DCONNECT_API_URL}/api/v1/installation/${installationId}/dum/${serial}`,
    ];

    for (const url of candidates) {
      try {
        const response = await this.api.get(url, {
          headers: this.getAuthHeaders(),
        });

        if (response.status >= 200 && response.status < 300 && response.data) {
          let payload = response.data;

          if (typeof payload?.status === 'string') {
            try {
              payload = {
                ...payload,
                status: JSON.parse(payload.status),
              };
            } catch {
              // leave as-is
            }
          }

          return {
            ...inventory,
            ...payload,
            _debugStatusSource: url,
          };
        }
      } catch {
        // try next
      }
    }

    return {
      ...inventory,
      _debugStatusSource: 'inventory-only',
      _debugStatusPayload: null,
    };
  }

  async getDeviceState(installationId: string, serial: string): Promise<any> {
    await this.login();

    const inventoryDevices = await this.getInstallationDevices(installationId);
    const inventory =
      inventoryDevices.find((d: any) => String(d.serial) === String(serial)) || null;

    if (this.fetchMethod === 'dabcs') {
      const statusDevice = await this.getDabcsDeviceState(installationId, serial);

      if (statusDevice) {
        return {
          ...inventory,
          ...statusDevice,
          status: statusDevice.status || null,
          _debugStatusSource: 'dabcs:/mobile/v1/installations/{id}/dums',
        };
      }
    }

    if (this.fetchMethod === 'dconnect') {
      return this.getDconnectDeviceState(installationId, serial, inventory);
    }

    return inventory;
  }

  async setDeviceParam(serial: string, key: string, value: string | number): Promise<void> {
    await this.login();

    console.log(`WRITE -> ${key}=${value}`);

    if (!this.fetchMethod) {
      throw new Error('No active DAB fetch method');
    }

    if (this.fetchMethod === 'dabcs') {
      const response = await this.api.post(
        `${DABCS_API_URL}/mobile/v1/dums/${serial}/setparam`,
        {
          key,
          value: String(value),
        },
        {
          params: {
            skipLogging: false,
          },
          headers: this.getAuthHeaders({
            'Content-Type': 'application/json',
          }),
        },
      );

      console.log('DABCS write response:', response.status, response.data);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`DABCS write failed (${response.status})`);
      }

      if (response.data?.res && response.data.res !== 'OK') {
        throw new Error(response.data?.message || 'DABCS write rejected');
      }

      return;
    }

    const response = await this.api.post(
      `${DCONNECT_API_URL}/dum/${serial}`,
      {
        key,
        value: String(value),
      },
      {
        headers: this.getAuthHeaders({
          'Content-Type': 'application/json',
        }),
      },
    );

    console.log('DCONNECT write response:', response.status, response.data);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`DConnect write failed (${response.status})`);
    }

    if (response.data?.res && response.data.res !== 'OK') {
      throw new Error(response.data?.message || 'DConnect write rejected');
    }
  }

  async setPumpEnabled(serial: string, enabled: boolean): Promise<void> {
    const code = enabled ? '0' : '1';
    await this.setDeviceParam(serial, 'PumpDisable', code);
  }

  async setPowerShowerEnabled(serial: string, enabled: boolean): Promise<void> {
    const code = enabled ? '1' : '0';
    await this.setDeviceParam(serial, 'PowerShowerCommand', code);
  }

  async setSleepModeEnabled(serial: string, enabled: boolean): Promise<void> {
    const code = enabled ? '1' : '0';
    await this.setDeviceParam(serial, 'SleepModeEnable', code);
  }

  async listDevices(): Promise<DABDevice[]> {
    const installations = await this.getInstallations();

    if (!installations.length) {
      throw new Error('No DAB installations found');
    }

    const devices: DABDevice[] = [];

    for (const installation of installations) {
      const installationId = String(
        installation.installation_id || installation.id || '',
      );
      const installationName = String(
        installation.name || installation.description || installationId || 'Installation',
      );

      if (!installationId) {
        continue;
      }

      const dums = await this.getInstallationDevices(installationId);

      for (let i = 0; i < dums.length; i += 1) {
        const dum = dums[i] || {};
        const serial = String(dum.serial || '');
        const configurationId = String(dum.configuration_id || '');

        if (!serial || !configurationId) {
          continue;
        }

        devices.push({
          id: serial,
          name: normalizeDeviceName(installationName, dum, i),
          installationId,
          serial,
          product: dum.ProductName || dum.distro_embedded || '',
          configurationId,
        });
      }
    }

    if (!devices.length) {
      throw new Error('No DAB devices found');
    }

    return devices;
  }
}