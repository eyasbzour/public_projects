import React from 'react'
import HeroImg from "../../assets/coffee2.png";

const Home = () => {
  return (
    <div className='min-h-[550px] sm:min-h-[600px] bg-brandDark
    flex justify-center items-center text-white
    '>
        <div className="container pb-8 sm:pb-0">
            <div className="grid grid-cols-1 sm:grid-cols-2">
                {/* text content section */}
                <div className='flex flex-col gap-6 order-2 sm:order-1' >
                    <h1 data-aos='fade-up' data-aos-once='true'
                    className='text-5xl sm:text-6xl lg:text-7xl font-bold'>
                        We serve the richest <span 
                        data-aos='zoom-out' data-aos-delay="300"
                         className='text-primary font-cursive'>
                            Coffee
                        </span>
                        {" "}
                        in the city</h1> 
                    <div >
                        <button data-aos='fade-up' data-aos-delay='400'
                        className='btn btn-primary
                         bg-gradient-to-r from-primary to-secondary
                         border-2 border-primary rounded-lg
                         py-2 px-4 text-white font-bold 
                         hover:from-primary/90 hover:to-secondary
                         hover:scale-105
                         transition duration-300 ease-in-out'>
                            Coffee and Smile
                        </button>
                    </div>
                </div>
                {/* image  section */}
                <div 
                data-aos='zoom-in' 
                className='min-h-[450px] flex justify-center items-center order-1 sm:order-2 relative'>
                    <img src={HeroImg} alt="Hero image" className='w-[300px] sm:w-[450px] sm:scale-125 m-auto animate-slow-spin'/>
                    <div  data-aos='fade-left' 
                    className='bg-gradient-to-r from-primary to-secondary absolute top-10 left-10 p-3 rounded-xl hover:from-primary/90 hover:to-secondary 
                         transition duration-300 ease-in-out'>
                        <h1>
                            Hey Customer
                        </h1>
                    </div>
                    <div data-aos='fade-right'
                     className='bg-gradient-to-r from-primary to-secondary absolute bottom-10 right-10 p-3 rounded-xl hover:from-primary/90 hover:to-secondary
                         transition duration-300 ease-in-out'>
                        <h1>
                            Taste the deffirence
                        </h1>
                    </div>
                </div>
            </div> 
        </div>
    </div>
  )
}

export default Home