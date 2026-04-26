declare module 'react-native-zeroconf' {
  export default class Zeroconf {
    on(event: string, listener: (...args: any[]) => void): void;
    removeAllListeners(): void;
    scan(type: string, protocol?: string, domain?: string): void;
    stop(): void;
  }
}
