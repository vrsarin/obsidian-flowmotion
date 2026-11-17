// Prints the entry for Obsidian's community-plugins.json, for the submission PR to obsidianmd/obsidian-releases.
// Nothing is sent anywhere; you paste the output into that PR yourself.
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const repo = process.env.FLOWMOTION_REPO ?? 'vrsarin/obsidian-flowmotion';
const entry = {
  id: manifest.id,
  name: manifest.name,
  author: manifest.author,
  description: manifest.description,
  repo,
};
console.log(JSON.stringify(entry, null, 2));
