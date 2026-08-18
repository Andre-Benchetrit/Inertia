import Image from "next/image"
import Link from "next/link"

type BrandProps = {
  href?: string
  className?: string
}

export default function Brand({ href = "/", className = "" }: BrandProps) {
  return (
    <Link
      href={href}
      aria-label="Inertia"
      className={`inline-flex items-center gap-2 text-[#65735f] ${className}`}
    >
      <Image
        src="/inertia-logo.png"
        alt=""
        width={34}
        height={34}
        priority
        className="rounded-xl object-cover"
      />
      <span className="font-semibold tracking-[0.2em] uppercase">Inertia</span>
    </Link>
  )
}
