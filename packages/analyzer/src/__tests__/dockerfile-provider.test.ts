import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { DockerfileProvider } from '../languages/dockerfile.js';

describe('DockerfileProvider', () => {
  const provider = new DockerfileProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('dockerfile');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Dockerfile');
    });

    it('should match Dockerfile globs', () => {
      expect(provider.globs).toContain('**/Dockerfile');
      expect(provider.globs).toContain('**/*.dockerfile');
    });

    it('should have "named" import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — FROM', () => {
    it('should parse a base image as an import', () => {
      const captures = provider.parse('FROM node:18-alpine', 'Dockerfile');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]?.name).toBe('node:18-alpine');
      expect(imports[0]?.properties?.baseImage).toBe('node:18-alpine');
      expect(imports[0]?.properties?.iaCType).toBe('DockerImage');
      expect(imports[0]?.properties?.isIaC).toBe('true');
    });

    it('should parse FROM with an AS stage alias', () => {
      const captures = provider.parse('FROM node:18 AS build', 'Dockerfile');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]?.name).toBe('node:18');
      expect(imports[0]?.properties?.stage).toBe('build');
    });

    it('should parse FROM without a tag', () => {
      const captures = provider.parse('FROM alpine', 'Dockerfile');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
      expect(imports[0]?.name).toBe('alpine');
      expect(imports[0]?.properties?.stage).toBe('');
    });

    it('should include filePath in FROM properties', () => {
      const captures = provider.parse('FROM ubuntu', 'myfile.dockerfile');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports[0]?.properties?.filePath).toBe('myfile.dockerfile');
    });
  });

  describe('parse — instructions', () => {
    it.each(['RUN npm install', 'COPY . /app', 'ADD src /app', 'CMD ["node", "index.js"]', 'ENTRYPOINT ["node"]'])(
      'should parse %s as a function call',
      (line) => {
        const captures = provider.parse(line, 'Dockerfile');
        const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.properties?.isIaC).toBe('true');
      },
    );

    it('should name the RUN capture RUN', () => {
      const captures = provider.parse('RUN apt-get update', 'Dockerfile');
      const calls = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
      expect(calls[0]?.name).toBe('RUN');
    });

    it('should parse ENV as a variable definition', () => {
      const captures = provider.parse('ENV NODE_ENV=production', 'Dockerfile');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(1);
      expect(vars[0]?.name).toBe('NODE_ENV');
    });

    it('should parse ARG as a variable definition', () => {
      const captures = provider.parse('ARG VERSION=1.0', 'Dockerfile');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(1);
      expect(vars[0]?.name).toBe('VERSION');
    });

    it('should parse EXPOSE, WORKDIR, VOLUME, USER', () => {
      const code = 'EXPOSE 8080\nWORKDIR /app\nVOLUME /data\nUSER nobody';
      const captures = provider.parse(code, 'Dockerfile');
      const names = captures.map((c) => c.name).sort();
      expect(names).toEqual(expect.arrayContaining(['EXPOSE', 'WORKDIR', 'VOLUME', 'USER']));
    });

    it('should parse LABEL as a variable definition', () => {
      const captures = provider.parse('LABEL maintainer="a@b.c"', 'Dockerfile');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars).toHaveLength(1);
      expect(vars[0]?.name).toBe('maintainer');
    });
  });

  describe('parse — edge cases', () => {
    it('should skip blank lines and comments', () => {
      const captures = provider.parse('# comment\n\nFROM alpine', 'Dockerfile');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(1);
    });

    it('should handle an empty Dockerfile', () => {
      const captures = provider.parse('', 'Dockerfile');
      expect(captures).toEqual([]);
    });

    it('should return captures sorted by line', () => {
      const code = 'FROM alpine\nRUN echo hi\nENV A=1';
      const captures = provider.parse(code, 'Dockerfile');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i]!.startLine).toBeGreaterThanOrEqual(captures[i - 1]!.startLine);
      }
    });

    it('should parse multiple FROM (multi-stage build)', () => {
      const code = 'FROM node:18 AS build\nRUN npm run build\nFROM nginx\nCOPY --from=build /app /usr/share/nginx/html';
      const captures = provider.parse(code, 'Dockerfile');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports).toHaveLength(2);
    });
  });

  describe('extractImports', () => {
    it('should extract FROM images', () => {
      const imports = provider.extractImports('FROM node:18\nRUN npm install');
      expect(imports).toHaveLength(1);
      expect(imports[0]?.source).toBe('node:18');
      expect(imports[0]?.type).toBe('named');
    });

    it('should include line numbers', () => {
      const imports = provider.extractImports('\nFROM alpine');
      expect(imports[0]?.lineNumber).toBe(2);
    });

    it('should handle a Dockerfile without FROM', () => {
      expect(provider.extractImports('RUN echo hi')).toEqual([]);
    });
  });

  describe('isExported', () => {
    it('should always return true', () => {
      expect(provider.isExported('', 'anything')).toBe(true);
    });
  });
});
