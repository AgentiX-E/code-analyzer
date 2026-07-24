import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface FixtureConfig {
  outputDir: string;
  fileCount: number;
  filesPerDir: number;
  seed?: number;
}

// Simple LCG random for deterministic generation
class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
    return (this.state >>> 0) / 0xffffffff;
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(arr: T[]): T { return arr[this.nextInt(0, arr.length - 1)]; }
}

const CLASS_NAMES = ['Service', 'Repository', 'Controller', 'Manager', 'Handler', 'Factory', 'Builder', 'Validator', 'Mapper', 'Helper', 'Provider', 'Adapter', 'Observer', 'Strategy', 'Decorator'];
const METHOD_NAMES = ['get', 'set', 'create', 'update', 'delete', 'find', 'list', 'process', 'validate', 'transform', 'execute', 'initialize', 'configure', 'handle', 'resolve'];
const PARAM_NAMES = ['id', 'name', 'data', 'options', 'config', 'params', 'input', 'output', 'value', 'key'];
const TYPE_NAMES = ['string', 'number', 'boolean', 'void', 'any', 'Promise<void>', 'Promise<string>', 'Record<string, unknown>', 'Array<string>', 'Map<string, number>'];

function generateClass(rng: SeededRandom, name: string, importNames: string[]): string {
  const methodCount = rng.nextInt(2, 6);
  const methods: string[] = [];
  
  for (let i = 0; i < methodCount; i++) {
    const mName = rng.pick(METHOD_NAMES) + (i > 0 ? String(i) : '');
    const paramCount = rng.nextInt(0, 3);
    const params = Array.from({ length: paramCount }, (_, j) => {
      const pName = PARAM_NAMES[j % PARAM_NAMES.length];
      const pType = rng.pick(TYPE_NAMES);
      return `${pName}: ${pType}`;
    }).join(', ');
    const retType = rng.pick(TYPE_NAMES);
    const bodyLines: string[] = [];
    // Add a call to another method or imported function
    if (importNames.length > 0 && rng.next() > 0.3) {
      const imported = rng.pick(importNames);
      bodyLines.push(`    ${imported}(${rng.pick(PARAM_NAMES)});`);
    }
    bodyLines.push(`    return ${retType === 'void' ? '' : retType === 'string' ? `'${mName}'` : retType === 'number' ? '42' : 'undefined'};`);
    
    methods.push(`  ${mName}(${params}): ${retType} {\n${bodyLines.join('\n')}\n  }`);
  }
  
  return `export class ${name} {\n${methods.join('\n\n')}\n}\n`;
}

function generateInterface(rng: SeededRandom, name: string): string {
  const propCount = rng.nextInt(1, 4);
  const props = Array.from({ length: propCount }, (_, i) => {
    const pName = PARAM_NAMES[i % PARAM_NAMES.length];
    const pType = rng.pick(TYPE_NAMES);
    return `  ${pName}: ${pType};`;
  }).join('\n');
  
  return `export interface ${name} {\n${props}\n}\n`;
}

function generateFunction(rng: SeededRandom, name: string, importNames: string[]): string {
  const paramCount = rng.nextInt(0, 3);
  const params = Array.from({ length: paramCount }, (_, j) => {
    const pName = PARAM_NAMES[j % PARAM_NAMES.length];
    const pType = rng.pick(TYPE_NAMES);
    return `${pName}: ${pType}`;
  }).join(', ');
  const retType = rng.pick(TYPE_NAMES);
  const bodyLines: string[] = [];
  if (importNames.length > 0 && rng.next() > 0.3) {
    const imported = rng.pick(importNames);
    bodyLines.push(`  ${imported}(${rng.pick(PARAM_NAMES)});`);
  }
  bodyLines.push(`  return ${retType === 'void' ? '' : retType === 'string' ? `'${name}'` : retType === 'number' ? '42' : 'undefined'};`);
  
  return `export function ${name}(${params}): ${retType} {\n${bodyLines.join('\n')}\n}\n`;
}

function generateImports(rng: SeededRandom, dirIndex: number, fileIndex: number, totalDirs: number, filesPerDir: number): string {
  const importCount = rng.nextInt(0, 3);
  if (importCount === 0) return '';
  
  const imports: string[] = [];
  for (let i = 0; i < importCount; i++) {
    // Import from another directory or same directory
    const targetDir = rng.nextInt(0, totalDirs - 1);
    const targetFile = rng.nextInt(0, filesPerDir - 1);
    const className = `${CLASS_NAMES[targetDir % CLASS_NAMES.length]}${targetFile}`;
    
    if (targetDir === dirIndex && targetFile === fileIndex) continue; // Skip self-import
    
    const dirName = `module_${String(targetDir).padStart(4, '0')}`;
    const fileName = `file_${String(targetFile).padStart(4, '0')}`;
    imports.push(`import { ${className} } from '../${dirName}/${fileName}';`);
  }
  return imports.join('\n') + '\n';
}

export function generateFixture(config: FixtureConfig): { totalFiles: number; totalSize: number } {
  const { outputDir, fileCount, filesPerDir, seed = 42 } = config;
  const rng = new SeededRandom(seed);
  
  // Clean and recreate output dir
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true });
  }
  mkdirSync(outputDir, { recursive: true });
  
  const totalDirs = Math.ceil(fileCount / filesPerDir);
  let totalSize = 0;
  let generated = 0;
  
  for (let dirIndex = 0; dirIndex < totalDirs && generated < fileCount; dirIndex++) {
    const dirName = `module_${String(dirIndex).padStart(4, '0')}`;
    const dirPath = join(outputDir, dirName);
    mkdirSync(dirPath, { recursive: true });
    
    for (let fileIndex = 0; fileIndex < filesPerDir && generated < fileCount; fileIndex++) {
      const fileName = `file_${String(fileIndex).padStart(4, '0')}.ts`;
      const className = `${CLASS_NAMES[dirIndex % CLASS_NAMES.length]}${fileIndex}`;
      
      // Collect import names for cross-references
      const importSection = generateImports(rng, dirIndex, fileIndex, totalDirs, filesPerDir);
      const importNames = importSection
        .match(/import \{ ([^}]+) \} from/g)
        ?.map(m => m.match(/\{ ([^}]+) \}/)?.[1])
        .filter(Boolean) ?? [];
      
      let content = '';
      
      // Interface (50% chance)
      if (rng.next() > 0.5) {
        content += generateInterface(rng, `I${className}`) + '\n';
      }
      
      // Main class
      content += generateClass(rng, className, importNames) + '\n';
      
      // Utility function (30% chance)
      if (rng.next() > 0.7) {
        content += generateFunction(rng, `${className}Util`, importNames) + '\n';
      }
      
      // Prepend imports at the top
      content = importSection + content;
      
      const filePath = join(dirPath, fileName);
      writeFileSync(filePath, content, 'utf-8');
      totalSize += Buffer.byteLength(content);
      generated++;
    }
  }
  
  // Write tsconfig.json
  const tsconfig = JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'node',
      strict: true,
      esModuleInterop: true,
    },
    include: ['**/*.ts'],
  }, null, 2);
  writeFileSync(join(outputDir, 'tsconfig.json'), tsconfig);
  
  return { totalFiles: generated, totalSize };
}
