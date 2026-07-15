#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

// Paths to local sequence.js packages
const homeDir = process.env.HOME
const basePath = `${homeDir}/Sandbox/sequence/sequence.js`
const localPackages = {
  "@0xsequence/wallet-core": `${basePath}/packages/wallet/core`,
  "@0xsequence/wallet-primitives": `${basePath}/packages/wallet/primitives`,
  "@0xsequence/wallet-wdk": `${basePath}/packages/wallet/wdk`,
}

// Find all pnpm package directories
const pnpmDir = path.join(__dirname, "../node_modules/.pnpm")
const packageDirs = fs
  .readdirSync(pnpmDir)
  .filter(
    (dir) =>
      dir.startsWith("@0xsequence+") &&
      (dir.includes("wallet-core") ||
        dir.includes("wallet-primitives") ||
        dir.includes("wallet-wdk")),
  )

console.log("Found package directories:", packageDirs)

packageDirs.forEach((packageDir) => {
  const fullPackageDir = path.join(pnpmDir, packageDir)
  const nodeModulesDir = path.join(fullPackageDir, "node_modules")

  if (!fs.existsSync(nodeModulesDir)) {
    console.log(`Creating node_modules directory for ${packageDir}`)
    fs.mkdirSync(nodeModulesDir, { recursive: true })
  }

  const sequenceDir = path.join(nodeModulesDir, "@0xsequence")
  if (!fs.existsSync(sequenceDir)) {
    console.log(`Creating @0xsequence directory for ${packageDir}`)
    fs.mkdirSync(sequenceDir, { recursive: true })
  }

  // Create symlinks for each package
  Object.entries(localPackages).forEach(([packageName, localPath]) => {
    const packageDirName = packageName.replace("@0xsequence/", "")
    const symlinkPath = path.join(sequenceDir, packageDirName)

    // Remove existing symlink or directory
    if (fs.existsSync(symlinkPath)) {
      console.log(`Removing existing ${symlinkPath}`)
      fs.rmSync(symlinkPath, { recursive: true, force: true })
    }

    // Create symlink
    console.log(`Creating symlink: ${symlinkPath} -> ${localPath}`)
    try {
      fs.symlinkSync(localPath, symlinkPath, "dir")
      console.log(`✓ Successfully linked ${packageName}`)
    } catch (error) {
      console.error(`✗ Failed to link ${packageName}:`, error.message)
    }
  })
})

console.log("Symlink creation complete!")
