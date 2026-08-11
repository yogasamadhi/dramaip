const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')
const path = require('path')

const projectRoot = __dirname
const clientsRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = Array.from(new Set([clientsRoot, ...(config.watchFolders || [])]))
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(clientsRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = false

module.exports = withNativeWind(config, { inlineRem: 16 })
