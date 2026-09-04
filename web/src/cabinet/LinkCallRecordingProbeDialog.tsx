import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'

type LinkCallRecordingProbeDialogProps = {
  open: boolean
  total: number
  checked: number
  onCancel: () => void
}

export function LinkCallRecordingProbeDialog({
  open,
  total,
  checked,
  onCancel,
}: LinkCallRecordingProbeDialogProps) {
  const progress = total > 0 ? Math.round((checked / total) * 100) : 0

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Проверка записей звонков</AlertDialogTitle>
          <AlertDialogDescription>
            Проверяю, открываются ли ссылки на записи. Это не синхронизация с AmoCRM.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Progress value={progress}>
          <ProgressLabel>Проверено</ProgressLabel>
          <ProgressValue>
            {() => `${checked} / ${total} (${progress}%)`}
          </ProgressValue>
        </Progress>

        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={onCancel}>
            Отмена
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
