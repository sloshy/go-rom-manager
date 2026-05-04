import { Component, Show } from 'solid-js'
import { useParams } from '@solidjs/router'
import { MappingEditor } from '../components/MappingEditor'

export const Editor: Component = () => {
  const params = useParams<{ id: string }>()
  return (
    <Show when={params.id} fallback={<div class="text-danger">Missing mapping id.</div>}>
      <MappingEditor id={params.id!} />
    </Show>
  )
}
