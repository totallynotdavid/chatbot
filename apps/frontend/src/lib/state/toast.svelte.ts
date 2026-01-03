type ToastType = "success" | "error" | "info";

type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

const TOAST_DURATION = 5000;

function createToastState() {
  let items = $state<Toast[]>([]);

  return {
    get items() {
      return items;
    },
    show(message: string, type: ToastType = "info") {
      const id = crypto.randomUUID();
      items = [...items, { id, message, type }];

      setTimeout(() => {
        this.remove(id);
      }, TOAST_DURATION);
    },
    success(message: string) {
      this.show(message, "success");
    },
    error(message: string) {
      this.show(message, "error");
    },
    info(message: string) {
      this.show(message, "info");
    },
    remove(id: string) {
      items = items.filter((t) => t.id !== id);
    },
  };
}

export const toast = createToastState();
