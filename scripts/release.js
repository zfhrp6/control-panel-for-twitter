const fs = require('fs')

const manifestPaths = ['./manifest.mv2.json', './manifest.mv3.json']
const optionsJsPath = './options.js'
const optionsHtmlPath = './options.html'
const safariManifestPath = './Safari/Shared (Extension)/Resources/manifest.json'
const safariProjectPath = './Safari/Control Panel for Twitter.xcodeproj/project.pbxproj'
const releaseType = process.argv[2]

function fail(message) {
  throw new Error(message)
}

function readFile(filename) {
  try {
    return fs.readFileSync(filename, 'utf8')
  }
  catch (error) {
    fail(`Required release file is unavailable: ${filename} (${error.message})`)
  }
}

function readManifests() {
  let manifests = manifestPaths.map(filename => {
    let content = readFile(filename)
    let manifest
    try {
      manifest = JSON.parse(content)
    }
    catch (error) {
      fail(`Invalid JSON in ${filename}: ${error.message}`)
    }
    if (typeof manifest.version !== 'string') {
      fail(`Missing string version in ${filename}`)
    }
    return {filename, content, manifest}
  })

  if (manifests[0].manifest.version !== manifests[1].manifest.version) {
    fail('MV2 and MV3 manifest versions differ')
  }
  return manifests
}

function updateCustomRelease() {
  let manifests = readManifests()
  let match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.exec(manifests[0].manifest.version)
  if (!match) {
    fail(`Invalid custom release version: ${manifests[0].manifest.version}`)
  }
  let components = match.slice(1).filter(component => component !== undefined).map(Number)
  if (components.some(component => !Number.isSafeInteger(component) || component > 65535)) {
    fail(`Custom release version components must be integers from 0 to 65535: ${manifests[0].manifest.version}`)
  }

  let suffix = components[3] === undefined ? 1 : components[3] + 1
  if (suffix > 65535) {
    fail(`Custom release suffix overflow: ${manifests[0].manifest.version}`)
  }
  let baseVersion = components.slice(0, 3).join('.')
  let nextVersion = `${baseVersion}.${suffix}`
  let displayVersion = `${baseVersion}-custom.${suffix}`
  let optionsJs = readFile(optionsJsPath)
  let optionsHtml = readFile(optionsHtmlPath)
  let downloadPattern = /control-panel-for-twitter-v[^'"\s]+\.config\.txt/g
  let versionPattern = /(id="version">)v[^<]*(<)/g
  let downloadMatches = [...optionsJs.matchAll(downloadPattern)]
  let versionMatches = [...optionsHtml.matchAll(versionPattern)]
  if (downloadMatches.length !== 1 || versionMatches.length !== 1) {
    fail('Expected exactly one config export filename and one options version label')
  }

  let updates = [
    ...manifests.map(({filename, content}) => {
      let versionPattern = /^(\s*)"version"\s*:\s*"[^"]+"(,?)\s*$/gm
      let versionMatches = [...content.matchAll(versionPattern)]
      let versionNamePattern = /("version_name"\s*:\s*")[^"]+(")/g
      let versionNameMatches = [...content.matchAll(versionNamePattern)]
      if (versionMatches.length !== 1 || versionNameMatches.length > 1) {
        fail(`Expected one version and at most one version_name in ${filename}`)
      }

      let updated = content.replace(versionPattern, (_, indent, comma) => versionNameMatches.length === 1
        ? `${indent}"version": "${nextVersion}"${comma}`
        : `${indent}"version": "${nextVersion}",\n${indent}"version_name": "${displayVersion}"${comma}`)
      if (versionNameMatches.length === 1) {
        updated = updated.replace(versionNamePattern, `$1${displayVersion}$2`)
      }
      return {filename, content: updated}
    }),
    {
      filename: optionsJsPath,
      content: optionsJs.replace(downloadPattern, `control-panel-for-twitter-v${displayVersion}.config.txt`),
    },
    {
      filename: optionsHtmlPath,
      content: optionsHtml.replace(versionPattern, `$1v${displayVersion}$2`),
    },
  ]
  updates.forEach(({filename, content}) => fs.writeFileSync(filename, content, 'utf8'))
  console.log(`Bumped custom release to v${displayVersion} (manifest ${nextVersion})`)
}

function updateUpstreamRelease() {
  if (!['patch', 'minor', 'major'].includes(releaseType)) {
    fail(`Invalid release type: ${releaseType}. Use patch, minor, major, or custom.`)
  }

  let manifests = readManifests()
  if (!/^\d+\.\d+\.\d+$/.test(manifests[0].manifest.version)) {
    fail('Upstream release mode requires a three-component version; use custom for four-component versions.')
  }

  const semver = require('semver')
  let nextVersion = semver.inc(manifests[0].manifest.version, releaseType)
  if (!nextVersion) {
    fail(`Could not increment version ${manifests[0].manifest.version} as ${releaseType}`)
  }

  let updates = [...manifestPaths, safariManifestPath].map(filename => ({
    filename,
    content: readFile(filename).replace(/("version"\s*:\s*")[^"]+(")/, `$1${nextVersion}$2`),
  }))
  updates.push({
    filename: optionsJsPath,
    content: readFile(optionsJsPath).replace(/control-panel-for-twitter-.+\.config\.txt/, `control-panel-for-twitter-v${nextVersion}.config.txt`),
  })
  updates.push({
    filename: optionsHtmlPath,
    content: readFile(optionsHtmlPath).replace(/id="version">[^<]+</, `id="version">v${nextVersion}<`),
  })
  updates.push({
    filename: safariProjectPath,
    content: readFile(safariProjectPath)
      .replace(/CURRENT_PROJECT_VERSION = (\d+)/g, (_, current) => `CURRENT_PROJECT_VERSION = ${Number(current) + 1}`)
      .replace(/MARKETING_VERSION = [^;]+/g, `MARKETING_VERSION = ${nextVersion}`),
  })
  updates.forEach(({filename, content}) => fs.writeFileSync(filename, content, 'utf8'))
  console.log(`Bumped to v${nextVersion}`)
}

try {
  if (releaseType === 'custom') {
    updateCustomRelease()
  }
  else {
    if (!releaseType) {
      console.error('Usage: npm run release -- (patch|minor|major|custom)')
      process.exitCode = 1
    }
    else {
      updateUpstreamRelease()
    }
  }
}
catch (error) {
  console.error(`Error: ${error.message}`)
  process.exitCode = 1
}
