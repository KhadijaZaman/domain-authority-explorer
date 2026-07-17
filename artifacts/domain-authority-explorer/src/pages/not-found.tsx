import { Link } from "wouter"
import { AlertCircle } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-6">
      <div className="flex flex-col items-center text-center max-w-md">
        <AlertCircle className="w-16 h-16 text-muted-foreground/30 mb-6" />
        <h1 className="text-4xl font-bold tracking-tight mb-3">404</h1>
        <p className="text-lg text-muted-foreground mb-8">
          The page you're looking for doesn't exist.
        </p>
        <Link 
          href="/" 
          className="inline-flex items-center justify-center h-10 px-6 font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Back to Explorer
        </Link>
      </div>
    </div>
  )
}
