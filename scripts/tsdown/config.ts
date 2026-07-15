import { readFileSync } from "node:fs"

type PackageJson = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

type EntryConfig = string | Record<string, string>
type TsdownOutputOptions = Record<string, unknown>
type TsdownOutputChunk = { isEntry?: boolean }

export type PackageBuildConfigOptions = {
  packageJsonUrl: URL
  entry: EntryConfig
  extraExternal?: string[]
  platform?: "browser" | "neutral" | "node"
  target?: string
  outDir?: string
  useClientBanner?: boolean
}

export function createExternalMatcher(
  packageJsonUrl: URL,
  extraExternal: string[] = [],
): (id: string) => boolean {
  const pkg = JSON.parse(readFileSync(packageJsonUrl, "utf-8")) as PackageJson
  const externalDeps = [
    ...new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...extraExternal,
    ]),
  ]

  return (id: string) =>
    externalDeps.some((dep) => id === dep || id.startsWith(`${dep}/`))
}

export function createPackageBuildConfig({
  packageJsonUrl,
  entry,
  extraExternal,
  platform = "neutral",
  target = "es2020",
  outDir = "dist",
  useClientBanner = false,
}: PackageBuildConfigOptions) {
  const isExternal = createExternalMatcher(packageJsonUrl, extraExternal)

  return {
    entry,
    format: "esm",
    platform,
    target,
    outDir,
    clean: false,
    sourcemap: false,
    dts: {
      sourcemap: false,
    },
    deps: {
      neverBundle: isExternal,
      dts: {
        neverBundle: isExternal,
      },
    },
    outputOptions: (options: TsdownOutputOptions) => ({
      ...options,
      entryFileNames: "[name].js",
      chunkFileNames: "[name]-[hash].js",
      ...(useClientBanner
        ? {
            banner: (chunk: TsdownOutputChunk) =>
              chunk.isEntry ? '"use client";\n' : "",
          }
        : {}),
    }),
  }
}
