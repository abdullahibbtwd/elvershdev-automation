export abstract class BaseProvider {
  protected assertConfigured(value: string | undefined, name: string): string {
    if (!value) {
      throw new Error(`${name} is not configured. Set the corresponding environment variable.`);
    }
    return value;
  }
}
