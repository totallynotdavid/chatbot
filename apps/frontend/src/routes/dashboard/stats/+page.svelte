<script lang="ts">
	import { formatDateTime } from "$lib/utils/date";
	import SectionShell from "$lib/components/ui/section-shell.svelte";

	interface LLMStats {
		operation: string;
		total_calls: number;
		error_count: number;
		avg_latency_ms: number;
	}

	interface LLMCall {
		id: string;
		phone_number: string;
		operation: string;
		status: "success" | "error";
		error_type?: string;
		error_message?: string;
		latency_ms: number;
		created_at: string;
		prompt: string;
		response?: string;
		context_metadata?: string;
	}

	export let data: {
		stats: LLMStats[];
		recentCalls: LLMCall[];
	};

	let expandedRows = new Set<string>();

	function toggleRow(id: string) {
		if (expandedRows.has(id)) {
			expandedRows.delete(id);
		} else {
			expandedRows.add(id);
		}
		expandedRows = expandedRows; // Trigger reactivity
	}

	// Calculate aggregate stats
	$: totalCalls = data.stats.reduce(
		(acc: number, s: LLMStats) => acc + s.total_calls,
		0,
	);
	$: totalErrors = data.stats.reduce(
		(acc: number, s: LLMStats) => acc + s.error_count,
		0,
	);
	$: errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;
	$: avgLatency =
		data.stats.length > 0
			? data.stats.reduce(
					(acc: number, s: LLMStats) => acc + s.avg_latency_ms,
					0,
				) / data.stats.length
			: 0;
</script>

<div class="min-h-screen bg-cream-100 text-ink-900 pb-20">
	<!-- Editorial Header -->
	<header class="pt-12 pb-8 px-8 border-b border-ink-200">
		<div class="max-w-7xl mx-auto">
			<h1 class="font-serif text-5xl mb-3 tracking-tight">
				Intelligence Logs
			</h1>
			<p class="font-sans text-ink-600 max-w-2xl text-lg">
				Real-time monitoring of LLM operations, performance metrics, and
				audit trails.
			</p>
		</div>
	</header>

	<main class="max-w-7xl mx-auto px-8 py-10">
		<!-- Summary Cards -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
			<div
				class="bg-white border border-ink-200 p-6 flex flex-col justify-between min-h-[160px]"
			>
				<span
					class="font-sans text-xs uppercase tracking-widest text-ink-400 font-medium"
					>Total Calls (24h)</span
				>
				<span class="font-serif text-5xl mt-2"
					>{totalCalls.toLocaleString()}</span
				>
			</div>

			<div
				class="bg-white border border-ink-200 p-6 flex flex-col justify-between min-h-[160px]"
			>
				<span
					class="font-sans text-xs uppercase tracking-widest text-ink-400 font-medium"
					>Error Rate</span
				>
				<div class="mt-2">
					<span
						class="font-serif text-5xl {errorRate > 1
							? 'text-red-600'
							: ''}"
					>
						{errorRate.toFixed(2)}%
					</span>
				</div>
			</div>

			<div
				class="bg-white border border-ink-200 p-6 flex flex-col justify-between min-h-[160px]"
			>
				<span
					class="font-sans text-xs uppercase tracking-widest text-ink-400 font-medium"
					>Avg Latency</span
				>
				<span class="font-serif text-5xl mt-2"
					>{Math.round(avgLatency)}<span
						class="text-2xl ml-1 text-ink-400 font-sans">ms</span
					></span
				>
			</div>
		</div>

		<!-- Log Table -->
		<SectionShell title="Recent Activity">
			<div class="overflow-x-auto bg-white border border-ink-200">
				<table class="w-full text-left border-collapse">
					<thead>
						<tr class="border-b border-ink-200 bg-cream-50">
							<th
								class="py-4 px-6 font-sans text-xs uppercase tracking-widest font-medium text-ink-400 w-16"
								>Status</th
							>
							<th
								class="py-4 px-6 font-sans text-xs uppercase tracking-widest font-medium text-ink-400"
								>Operation</th
							>
							<th
								class="py-4 px-6 font-sans text-xs uppercase tracking-widest font-medium text-ink-400"
								>Time</th
							>
							<th
								class="py-4 px-6 font-sans text-xs uppercase tracking-widest font-medium text-ink-400"
								>Internal Latency</th
							>
							<th
								class="py-4 px-6 font-sans text-xs uppercase tracking-widest font-medium text-ink-400"
								>Phone</th
							>
							<th
								class="py-4 px-6 font-sans text-xs uppercase tracking-widest font-medium text-ink-400 w-10"
							></th>
						</tr>
					</thead>
					<tbody class="font-sans text-sm">
						{#each data.recentCalls as call}
							<tr
								class="border-b border-ink-100 hover:bg-cream-50 transition-colors cursor-pointer group"
								on:click={() => toggleRow(call.id)}
							>
								<td class="py-4 px-6">
									{#if call.status === "success"}
										<div
											class="w-2.5 h-2.5 rounded-full bg-emerald-500"
										></div>
									{:else}
										<div
											class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"
										></div>
									{/if}
								</td>
								<td
									class="py-4 px-6 font-mono text-xs text-ink-600"
									>{call.operation}</td
								>
								<td class="py-4 px-6 text-ink-600"
									>{formatDateTime(call.created_at)}</td
								>
								<td class="py-4 px-6 font-mono text-xs">
									<span
										class={call.latency_ms > 1000
											? "text-amber-600 font-bold"
											: "text-ink-600"}
									>
										{call.latency_ms}ms
									</span>
								</td>
								<td class="py-4 px-6 text-ink-600"
									>{call.phone_number}</td
								>
								<td
									class="py-4 px-6 text-center text-ink-300 group-hover:text-ink-900 transition-colors"
								>
									{expandedRows.has(call.id) ? "−" : "+"}
								</td>
							</tr>

							{#if expandedRows.has(call.id)}
								<tr class="bg-cream-50/50">
									<td colspan="6" class="p-0">
										<div
											class="px-6 py-6 border-b border-ink-100 space-y-6"
										>
											<!-- Error Details if any -->
											{#if call.status === "error"}
												<div
													class="border-l-2 border-red-500 pl-4 py-1"
												>
													<h4
														class="font-serif text-red-700 text-lg mb-1"
													>
														Error: {call.error_type}
													</h4>
													<p
														class="font-mono text-xs text-red-600"
													>
														{call.error_message}
													</p>
												</div>
											{/if}

											<div class="grid grid-cols-2 gap-6">
												<div>
													<h4
														class="font-sans text-xs uppercase tracking-widest text-ink-400 mb-2"
													>
														System Prompt & Input
													</h4>
													<pre
														class="font-mono text-xs bg-white border border-ink-200 p-4 overflow-x-auto whitespace-pre-wrap text-ink-600 leading-relaxed max-h-96">{call.prompt}</pre>
												</div>
												<div>
													<h4
														class="font-sans text-xs uppercase tracking-widest text-ink-400 mb-2"
													>
														LLM Response
													</h4>
													<pre
														class="font-mono text-xs bg-white border border-ink-200 p-4 overflow-x-auto whitespace-pre-wrap text-ink-600 leading-relaxed max-h-96">{call.response ||
															"No response"}</pre>
												</div>
											</div>

											<!-- Metadata -->
											{#if call.context_metadata}
												<div>
													<h4
														class="font-sans text-xs uppercase tracking-widest text-ink-400 mb-2"
													>
														Context Metadata
													</h4>
													<pre
														class="font-mono text-xs text-ink-500">{JSON.stringify(
															JSON.parse(
																call.context_metadata,
															),
															null,
															2,
														)}</pre>
												</div>
											{/if}
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		</SectionShell>
	</main>
</div>

<style>
	/* Custom scrollbar for code blocks to keep it clean */
	pre::-webkit-scrollbar {
		width: 6px;
		height: 6px;
	}
	pre::-webkit-scrollbar-track {
		background: transparent;
	}
	pre::-webkit-scrollbar-thumb {
		background-color: var(--color-ink-200);
		border-radius: 3px;
	}
</style>
