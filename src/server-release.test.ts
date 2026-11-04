import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveJar } from "./backend.ts"
import { SERVER_VERSION, cachedJarPath, ensureReleaseJar, releaseUrl } from "./server-release.ts"

/**
 * 拆仓库之后界面拿后端的三条路。判错的代价：该用本地检出时去下载，开发者改的后端代码不生效；
 * 该下载时报错，只装了界面的用户根本起不来。
 */
describe("resolveJar", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "myagent-jar-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("MYAGENT_JAR 钉死的优先，不存在就报错、不替人重编译", () => {
    const jar = join(dir, "x.jar")
    writeFileSync(jar, "")
    expect(resolveJar(undefined, { MYAGENT_JAR: jar, MYAGENT_SERVER_DIR: dir })).toEqual({ kind: "pinned", path: jar })
    expect(() => resolveJar(join(dir, "没有.jar"), {})).toThrow("不存在")
  })

  test("MYAGENT_SERVER_DIR 指着后端检出：用它 target 下的 jar；不是后端仓库就说清楚", () => {
    writeFileSync(join(dir, "pom.xml"), "<project/>")
    expect(resolveJar(undefined, { MYAGENT_SERVER_DIR: dir })).toEqual({
      kind: "source",
      path: join(dir, "target", "myagent.jar"),
      serverDir: dir,
    })
    const empty = join(dir, "empty")
    mkdirSync(empty)
    expect(() => resolveJar(undefined, { MYAGENT_SERVER_DIR: empty })).toThrow("pom.xml")
  })

  test("都没给：下载发布版", () => {
    expect(resolveJar(undefined, {})).toEqual({ kind: "release" })
  })
})

describe("发布版下载", () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "myagent-home-"))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  test("地址钉在配套版本上，可以换镜像；缓存按版本分文件", () => {
    expect(releaseUrl("1.2.3", {})).toBe(
      "https://github.com/wiles-agent/myagent-server/releases/download/v1.2.3/myagent.jar",
    )
    expect(releaseUrl("1.2.3", { MYAGENT_SERVER_RELEASES: "https://mirror.example/dl/" })).toBe(
      "https://mirror.example/dl/v1.2.3/myagent.jar",
    )
    expect(cachedJarPath("1.2.3", home)).toBe(join(home, ".myagent", "server", "myagent-1.2.3.jar"))
    expect(releaseUrl()).toContain(`v${SERVER_VERSION}/`)
  })

  test("没缓存就下载，报一句进度；有缓存就不再联网", async () => {
    const path = cachedJarPath("9.9.9", home)
    const status: string[] = []
    let calls = 0
    const fake = (async () => {
      calls++
      return new Response(new Uint8Array([0x50, 0x4b]), { status: 200 })
    }) as unknown as typeof fetch

    expect(await ensureReleaseJar((s) => status.push(s), undefined, fake, path, "u")).toBe(path)
    expect(readFileSync(path)).toEqual(Buffer.from([0x50, 0x4b]))
    expect(status[0]).toContain("正在下载后端")

    await ensureReleaseJar(undefined, undefined, fake, path, "u")
    expect(calls).toBe(1)
  })

  test("下载失败：说清地址和退路，不留半截文件", async () => {
    const path = cachedJarPath("9.9.9", home)
    const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
    await expect(ensureReleaseJar(undefined, undefined, notFound, path, "https://x/v9.9.9/myagent.jar"))
      .rejects.toThrow(/HTTP 404[\s\S]*MYAGENT_JAR/)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(`${path}.part`)).toBe(false)

    const offline = (async () => {
      throw new Error("ENOTFOUND")
    }) as unknown as typeof fetch
    await expect(ensureReleaseJar(undefined, undefined, offline, path, "u")).rejects.toThrow("ENOTFOUND")
  })
})
