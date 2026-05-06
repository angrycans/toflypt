import { blue, green, red, yellow } from "@std/fmt/colors";
import { join, dirname } from "@std/path";

const TARGET_FILENAME = "hardware_settings_config.xml";
const NEW_UDP_ENTRY = '	    <udp enabled="true" extradata="3" ip="127.0.0.1" port="20778" delay="1" />';

function getPossiblePaths(): string[] {
  const paths: string[] = [];
  
  // 1. 当前运行目录
  paths.push(join(Deno.cwd(), TARGET_FILENAME));

  // 2. 用户文档目录 (DiRT Rally 2.0 默认位置)
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE");
  if (home) {
    paths.push(join(home, "Documents", "My Games", "DiRT Rally 2.0", "hardwaresettings", TARGET_FILENAME));
  }

  return paths;
}

async function makeWritable(path: string) {
  try {
    if (Deno.build.os === "windows") {
      // Windows: 使用 attrib 命令移除只读属性 (-R)
      const command = new Deno.Command("attrib", {
        args: ["-R", path],
      });
      await command.output();
    } else {
      // macOS/Linux: 赋予当前用户写权限
      const info = await Deno.stat(path);
      await Deno.chmod(path, info.mode! | 0o200);
    }
  } catch (e) {
    console.log(yellow(`Warning: Could not change file permissions for ${path}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function fixDirt2Config() {
  const possiblePaths = getPossiblePaths();
  let filePath = "";

  for (const p of possiblePaths) {
    try {
      const info = await Deno.stat(p);
      if (info.isFile) {
        filePath = p;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!filePath) {
    console.error(red(`Error: ${TARGET_FILENAME} not found.`));
    console.log(blue("\nSearched in:"));
    possiblePaths.forEach(p => console.log(`  - ${p}`));
    console.log(yellow("\nPlease make sure DiRT Rally 2.0 is installed or place this tool in the config folder."));
    Deno.exit(1);
  }

  try {
    console.log(blue(`Found config at: ${filePath}`));
    
    // 写入前尝试解除只读
    await makeWritable(filePath);

    console.log(blue(`Reading file...`));
    const content = await Deno.readTextFile(filePath);

    // 2. 备份原始文件
    const backupPath = `${filePath}.bak`;
    // 备份文件如果已存在也可能只读，尝试解除
    try { await Deno.remove(backupPath); } catch {} 
    await Deno.writeTextFile(backupPath, content);
    console.log(green(`Backup created at ${backupPath}`));

    // 3. 处理逻辑
    // 先清理掉所有旧的 extradata="3" 的 udp 行，然后统一插入一个正确的
    const lines = content.split(/\r?\n/);
    let inMotionPlatform = false;
    const cleanedLines: string[] = [];

    for (const line of lines) {
      if (line.includes("<motion_platform>")) {
        inMotionPlatform = true;
        cleanedLines.push(line);
        continue;
      }

      if (line.includes("</motion_platform>")) {
        inMotionPlatform = false;
        cleanedLines.push(line);
        continue;
      }

      // 如果在 motion_platform 内，且包含 extradata="3" 的 udp 标签，则跳过（即删除）
      if (inMotionPlatform && line.includes("<udp") && line.includes('extradata="3"')) {
        console.log(yellow(`Removing old UDP config: ${line.trim()}`));
        continue;
      }

      cleanedLines.push(line);
    }

    // 4. 插入唯一正确的一行
    const finalLines: string[] = [];
    let inserted = false;
    for (const line of cleanedLines) {
      finalLines.push(line);
      if (line.includes("<motion_platform>") && !inserted) {
        finalLines.push(NEW_UDP_ENTRY);
        inserted = true;
        console.log(green(`Inserted correct FlyPT UDP configuration.`));
      }
    }

    if (inserted) {
      await Deno.writeTextFile(filePath, finalLines.join("\n"));
      console.log(green(`Successfully cleaned and updated ${TARGET_FILENAME}.`));
    } else {
      console.error(red(`Could not find <motion_platform> section in the file.`));
    }

  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(red(`Error: ${TARGET_FILENAME} not found in current directory.`));
      console.log(blue(`Please place this executable in the same folder as your ${TARGET_FILENAME}`));
    } else {
      console.error(red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  console.log(blue("Dirt2 Hardware Settings Fixer for FlyPT starting..."));
  await fixDirt2Config();
}
