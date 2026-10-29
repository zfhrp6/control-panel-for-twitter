const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {spawnSync} = require('node:child_process')
const test = require('node:test')

const releaseScript = path.join(__dirname, 'release.js')

function createFixture(version = '4.25.1', mv3Version = version) {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cpft-release-'))
  fs.copyFileSync(releaseScript, path.join(directory, 'release.js'))
  fs.writeFileSync(path.join(directory, 'manifest.mv2.json'), JSON.stringify({manifest_version: 2, version}, null, 2))
  fs.writeFileSync(path.join(directory, 'manifest.mv3.json'), JSON.stringify({manifest_version: 3, version: mv3Version}, null, 2))
  fs.writeFileSync(path.join(directory, 'options.js'), "download = 'control-panel-for-twitter-v4.25.1.config.txt'\n")
  fs.writeFileSync(path.join(directory, 'options.html'), '<div id="version">v4.25.1</div>\n')
  return directory
}

function runRelease(directory, mode) {
  return spawnSync(process.execPath, [path.join(directory, 'release.js'), mode], {
    cwd: directory,
    encoding: 'utf8',
  })
}

function readFixture(directory) {
  return Object.fromEntries(['manifest.mv2.json', 'manifest.mv3.json', 'options.html', 'options.js'].map(filename => [
    filename,
    fs.readFileSync(path.join(directory, filename), 'utf8'),
  ]))
}

test('custom release increments the custom suffix and updates both browser manifests and options identifiers', () => {
  let directory = createFixture()
  let result = runRelease(directory, 'custom')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.mv2.json'))).version, '4.25.1.1')
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.mv3.json'))).version, '4.25.1.1')
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.mv2.json'))).version_name, '4.25.1-custom.1')
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.mv3.json'))).version_name, '4.25.1-custom.1')
  assert.match(fs.readFileSync(path.join(directory, 'options.html'), 'utf8'), /id="version">v4\.25\.1-custom\.1</)
  assert.match(fs.readFileSync(path.join(directory, 'options.js'), 'utf8'), /control-panel-for-twitter-v4\.25\.1-custom\.1\.config\.txt/)

  let next = runRelease(directory, 'custom')
  assert.equal(next.status, 0, next.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.mv2.json'))).version, '4.25.1.2')
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.mv2.json'))).version_name, '4.25.1-custom.2')
  assert.match(fs.readFileSync(path.join(directory, 'options.html'), 'utf8'), /v4\.25\.1-custom\.2/)
})

test('custom release rejects invalid, overflowing, or mismatched inputs without changing any release files', () => {
  for (let [version, mv3Version] of [
    ['4.25.invalid', '4.25.invalid'],
    ['4.25.1.65535', '4.25.1.65535'],
    ['4.25.1', '4.25.2.1'],
  ]) {
    let directory = createFixture(version, mv3Version)
    let before = readFixture(directory)
    let result = runRelease(directory, 'custom')

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Error:/)
    assert.deepEqual(readFixture(directory), before)
  }
})

test('custom release detects a missing required file before changing the other files', () => {
  let directory = createFixture()
  let before = readFixture(directory)
  fs.unlinkSync(path.join(directory, 'options.html'))
  let result = runRelease(directory, 'custom')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Required release file is unavailable/)
  for (let filename of ['manifest.mv2.json', 'manifest.mv3.json', 'options.js']) {
    assert.equal(fs.readFileSync(path.join(directory, filename), 'utf8'), before[filename])
  }
})

test('upstream release mode rejects four-component versions before writing', () => {
  let directory = createFixture('4.25.1.1')
  let before = readFixture(directory)
  let result = runRelease(directory, 'patch')

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /custom/)
  assert.deepEqual(readFixture(directory), before)
})
