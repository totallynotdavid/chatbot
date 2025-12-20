type ToastType = "success" | "error" | "info";

type Toast = {
    id: string;
    message: string;
    type: ToastType;
};

export const toasts = $state({
    items: [] as Toast[],

    show(message: string, type: ToastType = "info") {
        const id = crypto.randomUUID();
        this.items.push({ id, message, type });
        
        setTimeout(() => {
            this.remove(id);
        }, 5000);
    },

    success(message: string) {
        this.show(message, "success");
    },

    error(message: string) {
        this.show(message, "error");
    },

    remove(id: string) {
        this.items = this.items.filter((t) => t.id !== id);
    },
});
