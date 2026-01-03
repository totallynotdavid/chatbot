<script lang="ts">
import Badge from "$lib/components/ui/badge.svelte";
import { formatDateTime } from "$lib/utils/formatters";

type Event = {
  id: string;
  phone_number: string;
  event_type: string;
  metadata: string | null;
  created_at: string;
};

type Props = {
  events: Event[];
};

let { events }: Props = $props();

function getEventVariant(eventType: string) {
  if (eventType.includes("failed")) return "error" as const;
  if (eventType.includes("passed")) return "success" as const;
  return "default" as const;
}
</script>

<div class="bg-white border border-cream-200 shadow-sm">
	<div class="border-b border-cream-200 p-6">
		<h2 class="text-2xl font-serif">Eventos recientes</h2>
	</div>
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="bg-cream-100 font-mono text-xs uppercase tracking-wider">
				<tr>
					<th class="text-left p-4">Timestamp</th>
					<th class="text-left p-4">Teléfono</th>
					<th class="text-left p-4">Evento</th>
					<th class="text-left p-4">Metadata</th>
				</tr>
			</thead>
			<tbody class="font-mono text-xs">
				{#each events as event (event.id)}
					<tr class="border-b border-cream-100 hover:bg-cream-50">
						<td class="p-4 text-ink-400">{formatDateTime(event.created_at)}</td>
						<td class="p-4">{event.phone_number}</td>
						<td class="p-4">
							<Badge variant={getEventVariant(event.event_type)}>
								{event.event_type}
							</Badge>
						</td>
						<td class="p-4 text-ink-400 max-w-xs truncate">
							{event.metadata || "{}"}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
