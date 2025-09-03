import ProfileForm from '@/components/ProfileForm'

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-[#0d0f1a] p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8 text-center">Profile Settings</h1>
        <div className="flex justify-center">
          <ProfileForm />
        </div>
      </div>
    </div>
  )
}
