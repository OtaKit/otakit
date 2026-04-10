import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function ask(message: string): Promise<string> {
  const prompt = createInterface({ input, output });
  try {
    return await prompt.question(message);
  } finally {
    prompt.close();
  }
}

export async function confirm(message: string): Promise<boolean> {
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    prompt.close();
  }
}
