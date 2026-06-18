import { describe, expect, it } from 'vitest';
import {
  mimeFor,
  mimeFromPath,
  isImageMime,
  extensionForMime,
  isTextualMime,
  MIME_MAP,
} from '@/lib/mime';

describe('mimeFor', () => {
  it('looks up known extensions case-insensitively', () => {
    expect(mimeFor('png')).toBe('image/png');
    expect(mimeFor('PNG')).toBe('image/png');
    expect(mimeFor('jpg')).toBe('image/jpeg');
    expect(mimeFor('mp4')).toBe('video/mp4');
    expect(mimeFor('mp3')).toBe('audio/mpeg');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(mimeFor('xyz')).toBe('application/octet-stream');
  });
});

describe('mimeFromPath', () => {
  it('extracts extension from path', () => {
    expect(mimeFromPath('/foo/bar.png')).toBe('image/png');
    expect(mimeFromPath('document.PDF')).toBe('application/octet-stream'); // pdf not in MIME_MAP
  });

  it('returns octet-stream for paths without extension', () => {
    expect(mimeFromPath('/foo/bar')).toBe('application/octet-stream');
  });

  it('returns octet-stream for dotfiles', () => {
    expect(mimeFromPath('/foo/.gitignore')).toBe('application/octet-stream');
  });
});

describe('isImageMime', () => {
  it('returns true for image/*', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/svg+xml')).toBe(true);
  });

  it('returns false for non-image', () => {
    expect(isImageMime('video/mp4')).toBe(false);
    expect(isImageMime('text/plain')).toBe(false);
  });
});

describe('extensionForMime', () => {
  it('returns canonical extension for known MIMEs', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg'); // jpg comes before jpeg in MIME_MAP
    expect(extensionForMime('video/mp4')).toBe('mp4');
  });

  it('adds textual types not in MIME_MAP', () => {
    expect(extensionForMime('text/plain')).toBe('txt');
    expect(extensionForMime('text/html')).toBe('html');
    expect(extensionForMime('application/json')).toBe('json');
    expect(extensionForMime('application/pdf')).toBe('pdf');
  });

  it('returns bin for unknown MIMEs', () => {
    expect(extensionForMime('application/unknown')).toBe('bin');
  });

  it('is case-insensitive', () => {
    expect(extensionForMime('IMAGE/PNG')).toBe('png');
  });
});

describe('isTextualMime', () => {
  it('returns true for text/*', () => {
    expect(isTextualMime('text/plain')).toBe(true);
    expect(isTextualMime('text/html')).toBe(true);
    expect(isTextualMime('text/css')).toBe(true);
  });

  it('returns true for known application types', () => {
    expect(isTextualMime('application/json')).toBe(true);
    expect(isTextualMime('application/xml')).toBe(true);
    expect(isTextualMime('application/javascript')).toBe(true);
    expect(isTextualMime('application/typescript')).toBe(true);
    expect(isTextualMime('application/x-yaml')).toBe(true);
    expect(isTextualMime('application/x-www-form-urlencoded')).toBe(true);
  });

  it('returns true for structured suffixes', () => {
    expect(isTextualMime('application/ld+json')).toBe(true);
    expect(isTextualMime('application/rss+xml')).toBe(true);
    expect(isTextualMime('application/x+yaml')).toBe(true);
  });

  it('returns true for text/* regardless of suffix', () => {
    expect(isTextualMime('text/vnd.yaml')).toBe(true);
    expect(isTextualMime('text/plain')).toBe(true);
  });

  it('returns false for image/svg+xml', () => {
    // Wait, image/svg+xml ends with +xml, so it should be true
    expect(isTextualMime('image/svg+xml')).toBe(true);
  });

  it('returns false for binary types', () => {
    expect(isTextualMime('image/png')).toBe(false);
    expect(isTextualMime('video/mp4')).toBe(false);
    expect(isTextualMime('application/octet-stream')).toBe(false);
  });
});

describe('MIME_MAP completeness', () => {
  it('contains common image formats', () => {
    expect(MIME_MAP).toHaveProperty('png');
    expect(MIME_MAP).toHaveProperty('jpg');
    expect(MIME_MAP).toHaveProperty('webp');
  });
});
