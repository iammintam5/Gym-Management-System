import {
  AttendanceStatus,
  BookingStatus,
  CheckinStatus,
  effectiveSubscriptionStatus,
  FreezeStatus,
  PaymentStatus,
  QuotaTransactionType,
  SubscriptionStatus,
} from '@gym/contracts';
import { Badge, type BadgeProps } from '@/components/ui/badge';

export interface SubscriptionStatusBadgeProps extends Omit<
  BadgeProps,
  'variant' | 'children'
> {
  status?: SubscriptionStatus | string | null;
  endDate?: string | Date | null;
}

export function SubscriptionStatusBadge({
  status,
  endDate,
  dot = true,
  ...props
}: SubscriptionStatusBadgeProps) {
  const resolvedStatus =
    endDate && status
      ? effectiveSubscriptionStatus(status as SubscriptionStatus, endDate)
      : status;

  if (resolvedStatus === SubscriptionStatus.EXPIRED) {
    return (
      <Badge variant="destructive" dot={dot} {...props}>
        Hết hạn
      </Badge>
    );
  }
  if (status === SubscriptionStatus.ACTIVE) {
    return (
      <Badge variant="success" dot={dot} {...props}>
        Đang tập
      </Badge>
    );
  }
  if (status === SubscriptionStatus.UPCOMING) {
    return (
      <Badge variant="warning" dot={dot} {...props}>
        Sắp kích hoạt
      </Badge>
    );
  }
  if (status === SubscriptionStatus.SUSPENDED) {
    return (
      <Badge variant="warning" dot={dot} {...props}>
        Đang bảo lưu
      </Badge>
    );
  }
  if (status === SubscriptionStatus.CANCELLED) {
    return (
      <Badge variant="destructive" dot={dot} {...props}>
        Đã huỷ
      </Badge>
    );
  }
  return (
    <Badge variant="outline" dot={dot} {...props}>
      Chưa có gói
    </Badge>
  );
}

export function PaymentStatusBadge({
  status,
  dot = true,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  status: PaymentStatus | string;
}) {
  if (status === PaymentStatus.PAID) {
    return (
      <Badge variant="success" dot={dot} {...props}>
        Đã thanh toán
      </Badge>
    );
  }
  if (status === PaymentStatus.PENDING) {
    return (
      <Badge variant="warning" dot={dot} {...props}>
        Chờ xác nhận
      </Badge>
    );
  }
  if (status === PaymentStatus.REFUNDED) {
    return (
      <Badge variant="destructive" dot={dot} {...props}>
        Đã hoàn tiền
      </Badge>
    );
  }
  return (
    <Badge variant="outline" dot={dot} {...props}>
      Đã huỷ
    </Badge>
  );
}

export function BookingStatusBadge({
  status,
  attendance,
  dot = true,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  status: BookingStatus | string;
  attendance?: AttendanceStatus | string;
}) {
  if (status === BookingStatus.CANCELLED) {
    return (
      <Badge variant="outline" dot={dot} {...props}>
        Đã huỷ đúng hạn
      </Badge>
    );
  }
  if (
    status === BookingStatus.NO_SHOW ||
    attendance === AttendanceStatus.NO_SHOW ||
    attendance === AttendanceStatus.ABSENT
  ) {
    return (
      <Badge variant="destructive" dot={dot} {...props}>
        Vắng mặt (Trừ lượt)
      </Badge>
    );
  }
  if (
    status === BookingStatus.COMPLETED ||
    attendance === AttendanceStatus.PRESENT
  ) {
    return (
      <Badge variant="success" dot={dot} {...props}>
        Có mặt (Đã tập)
      </Badge>
    );
  }
  return (
    <Badge variant="warning" dot={dot} {...props}>
      Đang giữ chỗ
    </Badge>
  );
}

export function FreezeStatusBadge({
  status,
  dot = true,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  status: FreezeStatus | string;
}) {
  if (status === FreezeStatus.APPROVED) {
    return (
      <Badge variant="warning" dot={dot} {...props}>
        Đang bảo lưu
      </Badge>
    );
  }
  if (status === FreezeStatus.REQUESTED) {
    return (
      <Badge variant="primary" dot={dot} {...props}>
        Chờ duyệt
      </Badge>
    );
  }
  if (status === FreezeStatus.COMPLETED) {
    return (
      <Badge variant="success" dot={dot} {...props}>
        Đã mở lại
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" dot={dot} {...props}>
      Từ chối / Huỷ
    </Badge>
  );
}

export function CheckinStatusBadge({
  status,
  dot = true,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  status: CheckinStatus | string;
}) {
  if (status === CheckinStatus.ACCEPTED) {
    return (
      <Badge variant="success" dot={dot} {...props}>
        Hợp lệ qua cổng
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" dot={dot} {...props}>
      Từ chối vào cổng
    </Badge>
  );
}

export function QuotaTxTypeBadge({
  type,
  ...props
}: Omit<BadgeProps, 'variant' | 'children'> & {
  type: QuotaTransactionType | string;
}) {
  if (type === QuotaTransactionType.RESERVE) {
    return (
      <Badge variant="warning" {...props}>
        Giữ chỗ
      </Badge>
    );
  }
  if (type === QuotaTransactionType.USE) {
    return (
      <Badge variant="success" {...props}>
        Trừ lượt tập
      </Badge>
    );
  }
  if (type === QuotaTransactionType.REFUND) {
    return (
      <Badge variant="primary" {...props}>
        Hoàn lượt
      </Badge>
    );
  }
  return (
    <Badge variant="outline" {...props}>
      Điều chỉnh
    </Badge>
  );
}
