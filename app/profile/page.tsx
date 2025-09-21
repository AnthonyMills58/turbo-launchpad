import ProfileForm from '@/components/ProfileForm'

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <div className="min-h-screen bg-transparent p-6">
        <div className="max-w-4xl mx-auto">
         
          <div className="flex justify-center">
            <ProfileForm />
          </div>
        </div>
      </div>
    </div>
  )
}
