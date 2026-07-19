// Keep the Electron-main BFF boundary explicit and narrow. This is mirrored
// by dramaip-platform/clients/packages/sdk/contracts.ts; Desktop deliberately
// does not import the platform's internal/core models.
export const DESKTOP_CONTRACT_VERSION = '1'
export const DESKTOP_CONTRACT_HEADER = 'X-DramaIP-Contract-Version'
