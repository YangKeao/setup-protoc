// Load tempDirectory before it gets wiped by tool-cache
let tempDirectory = process.env["RUNNER_TEMP"] || "";

import * as os from "os";
import * as path from "path";
import * as util from "util";
import * as restm from "typed-rest-client/RestClient";
import * as semver from "semver";

if (!tempDirectory) {
  let baseLocation;
  if (process.platform === "win32") {
    // On windows use the USERPROFILE env variable
    baseLocation = process.env["USERPROFILE"] || "C:\\";
  } else {
    if (process.platform === "darwin") {
      baseLocation = "/Users";
    } else {
      baseLocation = "/home";
    }
  }
  tempDirectory = path.join(baseLocation, "actions", "temp");
}

import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as exc from "@actions/exec";
import * as io from "@actions/io";

let osPlat: string = os.platform();
let osArch: string = os.arch();

interface IProtocRelease {
  tag_name: string;
  prerelease: boolean;
}

export async function getProtoc(
  version: string,
  includePreReleases: boolean,
  repoToken: string
) {
  if (!version.startsWith("v")) {
    version = "v" + version
  }
  process.stdout.write("Getting protoc version: " + version + os.EOL);

  // look if the binary is cached
  let toolPath: string;
  toolPath = tc.find("protoc", version);

  // if not: download, extract and cache
  if (!toolPath) {
    toolPath = await downloadRelease(version);
    process.stdout.write("Protoc cached under " + toolPath + os.EOL);
  }

  // add the bin folder to the PATH
  toolPath = path.join(toolPath, "bin");
  core.addPath(toolPath);

  // make available Go-specific compiler to the PATH,
  // this is needed because of https://github.com/actions/setup-go/issues/14

  const goBin: string = await io.which("go", false);
  if (goBin) {
    // Go is installed, add $GOPATH/bin to the $PATH because setup-go
    // doesn't do it for us.
    let stdOut = "";
    let options = {
      listeners: {
        stdout: (data: Buffer) => {
          stdOut += data.toString();
        }
      }
    };

    await exc.exec("go", ["env", "GOPATH"], options);
    const goPath: string = stdOut.trim();
    core.debug("GOPATH: " + goPath);

    core.addPath(path.join(goPath, "bin"));
  }
}

async function downloadRelease(version: string): Promise<string> {
  // Download
  let fileName: string = getFileName(version);
  let downloadUrl: string = util.format(
    "https://github.com/protocolbuffers/protobuf/releases/download/%s/%s",
    version,
    fileName
  );
  process.stdout.write("Downloading archive: " + downloadUrl + os.EOL);

  let downloadPath: string | null = null;
  try {
    downloadPath = await tc.downloadTool(downloadUrl);
  } catch (error) {
    core.debug(error);
    throw `Failed to download version ${version}: ${error}`;
  }

  // Extract
  let extPath: string = await tc.extractZip(downloadPath);

  // Install into the local tool cache - node extracts with a root folder that matches the fileName downloaded
  return await tc.cacheDir(extPath, "protoc", version);
}

function getFileName(version: string): string {
  // to compose the file name, strip the leading `v` char
  if (version.startsWith("v")) {
    version = version.slice(1, version.length);
  }

  // The name of the Windows package has a different naming pattern
  if (osPlat == "win32") {
    const arch: string = osArch == "x64" ? "64" : "32";
    return util.format("protoc-%s-win%s.zip", version, arch);
  }

  const arch: string = osArch == "x64" ? "x86_64" : "x86_32";

  if (osPlat == "darwin") {
    return util.format("protoc-%s-osx-%s.zip", version, arch);
  }

  return util.format("protoc-%s-linux-%s.zip", version, arch);
}