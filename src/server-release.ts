/**
 * 后端 jar 从哪儿来。
 *
 * 界面和后端拆成两个仓库之后（wiles-agent/myagent-tui 和 wiles-agent/myagent-server），
 * 界面手上不再有后端源码，没法像以前那样就地 `mvn package`。
 * 照 linyu 那样各端各一个仓库的路子，后端每次打 tag 由 GitHub Actions 发一个 jar 到 Releases，
 * 界面**钉死一个版本**、第一次运行时下载到 `~/.myagent/server/`，之后直接用缓存。
 *
 * 为什么钉版本而不是追 latest：协议是两边的契约（docs/protocol.md），后端发了个
 * 不兼容的新版，追 latest 的界面会在用户毫不知情时连不上。钉住版本，升级就是界面这边
 * 一次显式的提交——改 {@link SERVER_VERSION}、跑测试、发版。
 *
 * 三条来源，优先级从高到低（见 backend.ts 的 resolveJar）：
 * 1. `MYAGENT_JAR` / jar 参数：用户钉死的某个 jar，不存在就报错
 * 2. `MYAGENT_SERVER_DIR`：后端仓库的本地检出，开发时用，缺了或旧了就地 build
 * 3. 这里：按 {@link SERVER_VERSION} 下载的发布版
 */

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 界面配套的后端版本。改它就是升级后端，记得同时确认协议版本对得上。 */
export const SERVER_VERSION = '1.0.0'

/** 发布地址。`MYAGENT_SERVER_RELEASES` 可以换成镜像（国内下 GitHub 慢的时候）。 */
export function releaseUrl(version: string = SERVER_VERSION, env = process.env): string {
  const base = env['MYAGENT_SERVER_RELEASES']?.replace(/\/+$/, '')
    ?? 'https://github.com/wiles-agent/myagent-server/releases/download'
  return `${base}/v${version}/myagent.jar`
}

/** 下载下来的 jar 放哪儿。按版本分文件，升级不覆盖旧的，回退也不用重下。 */
export function cachedJarPath(version: string = SERVER_VERSION, home: string = homedir()): string {
  return join(home, '.myagent', 'server', `myagent-${version}.jar`)
}

/**
 * 没缓存就下载。先写到临时文件、下完再改名：下到一半断网的话，
 * 留下的是一个 .part，而不是一个下次会被当成完好 jar 拿去跑的半截文件。
 */
export async function ensureReleaseJar(
  onStatus?: (text: string) => void,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  path: string = cachedJarPath(),
  url: string = releaseUrl(),
): Promise<string> {
  if (existsSync(path)) return path
  onStatus?.(`第一次运行，正在下载后端 v${SERVER_VERSION}…`)
  let response: Response
  try {
    response = await fetchImpl(url, { signal, redirect: 'follow' })
  } catch (error) {
    throw new Error(`下载后端失败：${(error as Error).message}\n地址：${url}\n`
      + `网络不通的话，可以自己下好这个 jar，用 MYAGENT_JAR 指过去。`)
  }
  if (!response.ok) {
    throw new Error(`下载后端失败：HTTP ${response.status}\n地址：${url}\n`
      + `可能是这个版本还没发布。可以用 MYAGENT_JAR 指向一个 jar，`
      + `或用 MYAGENT_SERVER_DIR 指向后端仓库的本地检出。`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  mkdirSync(dirname(path), { recursive: true })
  const part = `${path}.part`
  try {
    writeFileSync(part, bytes)
    renameSync(part, path)
  } catch (error) {
    rmSync(part, { force: true })
    throw error
  }
  return path
}
