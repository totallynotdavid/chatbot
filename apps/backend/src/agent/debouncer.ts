type DebouncedMessage = {
    phoneNumber: string;
    messages: string[];
    timeoutId: Timer;
};

const DEBOUNCE_DELAY_MS = 3000;
const messageBuffers = new Map<string, DebouncedMessage>();

type ProcessCallback = (phoneNumber: string, aggregatedText: string) => void;

export function debounceMessage(
    phoneNumber: string,
    messageText: string,
    onProcess: ProcessCallback,
): void {
    const existing = messageBuffers.get(phoneNumber);

    if (existing) {
        clearTimeout(existing.timeoutId);
        existing.messages.push(messageText);
    } else {
        messageBuffers.set(phoneNumber, {
            phoneNumber,
            messages: [messageText],
            timeoutId: null as any,
        });
    }

    const buffer = messageBuffers.get(phoneNumber)!;
    buffer.timeoutId = setTimeout(() => {
        const aggregated = buffer.messages.join(" ");
        messageBuffers.delete(phoneNumber);
        onProcess(phoneNumber, aggregated);
    }, DEBOUNCE_DELAY_MS);
}

export function clearDebounceBuffer(phoneNumber: string): void {
    const existing = messageBuffers.get(phoneNumber);
    if (existing) {
        clearTimeout(existing.timeoutId);
        messageBuffers.delete(phoneNumber);
    }
}
