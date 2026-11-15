const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
let count = 0;
function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'assets') continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (file.endsWith('.js')) {
            const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
            if (result.status) {
                process.stderr.write(result.stderr);
                process.exitCode = 1;
            }
            const source = fs.readFileSync(file, 'utf8');
            for (const match of source.matchAll(/(?:from\s*|require\()\s*['"](\.[^'"]+)['"]/g)) {
                const target = path.resolve(path.dirname(file), match[1]);
                if (!fs.existsSync(target) && !fs.existsSync(target + '.js')) {
                    console.error('Unresolved import:', file, match[1]);
                    process.exitCode = 1;
                }
            }
            count++;
        }
    }
}
visit('src');
visit('tests');
visit('benchmarks');
if (!process.exitCode) console.log(`Syntax and relative module resolution passed (${count} files)`);
